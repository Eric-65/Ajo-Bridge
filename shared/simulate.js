/**
 * Ajo Bridge — scenario runner.
 *
 * Plays a whole circle through the shared engine (the same code the contract
 * runs) and keeps the books: every deposit into the circle and every transfer
 * out of it is tallied per account. Used by the tests, `npm run demo` and the
 * walk-away simulator page.
 */

import {
  STATUS, collateralOf, contribute, createCircle, finalize, join, minReserve, requiredCollateral,
  settleRound, vouch, vouchedTotal,
} from './ajoEngine.js';
import { big } from './ajoMath.js';

export const DEMO_NAMES = [
  'ada', 'bayo', 'chidi', 'dupe', 'emeka', 'funke', 'gbenga', 'halima', 'ife', 'jide', 'kemi', 'lanre',
];

const ROUND_NS = 60n * 1_000_000_000n;

/**
 * @param {object} scenario
 * @param {number} scenario.n
 * @param {bigint|string|number} scenario.contribution
 * @param {number} [scenario.coverageBps=10000]
 * @param {number} [scenario.orderFeeBps=0]
 * @param {(slot: number, round: number) => boolean} [scenario.pays]  does the member in `slot` pay `round`?
 * @param {Array<{slot: number, voucher: string, amount: bigint|string|number}>} [scenario.vouches]
 * @param {string[]} [scenario.names]
 * @returns {{circle: object, rounds: object[], ledger: object[], accounts: object, totals: object}}
 */
export function runScenario(scenario) {
  const {
    n,
    contribution,
    coverageBps = 10000,
    orderFeeBps = 0,
    pays = () => true,
    vouches = [],
    names = DEMO_NAMES,
  } = scenario;
  if (names.length < n) throw new Error(`need at least ${n} member names`);

  let now = 1_000_000_000_000_000_000n;
  const accounts = {};
  const book = (account) => (accounts[account] ??= { deposited: 0n, withdrawn: 0n });
  const apply = (fx, depositor, deposit) => {
    if (depositor) book(depositor).deposited += deposit;
    for (const t of fx.transfers) book(t.to).withdrawn += t.amount;
    return fx;
  };

  const created = createCircle({
    id: 0, creator: names[0], name: scenario.name ?? 'Simulated circle',
    n, contribution, coverageBps, orderFeeBps, roundNs: ROUND_NS, now,
  });
  const circle = created.circle;

  // Join: every member reserves their slot; vouchers fill the gap; members cover whatever is left.
  for (let slot = 1; slot <= n; slot++) {
    const account = names[slot - 1];
    const required = requiredCollateral(circle, slot);
    const vouched = vouches.filter((v) => v.slot === slot).reduce((sum, v) => sum + big(v.amount), 0n);
    const reserve = minReserve(circle, slot);
    const own = required - vouched > reserve ? required - vouched : reserve;
    apply(join(circle, { account, slot, deposit: own, now }), account, own);
  }
  for (const v of vouches) {
    const amount = big(v.amount);
    apply(vouch(circle, { voucher: v.voucher, member: names[v.slot - 1], deposit: amount, now }), v.voucher, amount);
  }
  if (circle.status !== STATUS.ACTIVE) throw new Error('scenario did not start: collateral is incomplete');

  const snapshot = () => ({
    status: circle.status,
    fee_pool: circle.fee_pool,
    shortfall: circle.shortfall,
    members: circle.slots.map((account) => {
      const m = circle.members[account];
      return {
        account, slot: m.slot, stake: m.stake, vouched: vouchedTotal(m), collateral: collateralOf(m),
        received: m.received, contributed: m.contributed, slashed: m.slashed, vouch_slashed: m.vouch_slashed,
        defaulted: m.defaulted, paid_out: m.paid_out, short: m.short,
      };
    }),
  });

  const rounds = [];
  const start = snapshot();
  for (let round = 1; round <= n; round++) {
    const events = [];
    const transfers = [];
    const collect = (fx) => { events.push(...fx.events); transfers.push(...fx.transfers); };
    for (let slot = 1; slot <= n; slot++) {
      if (!pays(slot, round)) continue;
      const account = names[slot - 1];
      collect(apply(contribute(circle, { account, deposit: circle.contribution, now }), account, circle.contribution));
    }
    const stillOpen = circle.status === STATUS.ACTIVE && circle.round === round;
    if (stillOpen) {
      now = circle.deadline_ns;
      collect(apply(settleRound(circle, { now })));
    }
    now += 1_000_000_000n;
    rounds.push({ round, recipient: names[round - 1], events, transfers, record: circle.rounds[round - 1], after: snapshot() });
  }

  const closing = apply(finalize(circle, { now }));

  const ledger = [];
  for (let slot = 1; slot <= n; slot++) {
    const account = names[slot - 1];
    const m = circle.members[account];
    const a = book(account);
    ledger.push({
      account, slot, role: 'member', defaulted: m.defaulted, missed: m.missed,
      contributed: m.contributed, received: m.received, slashed: m.slashed, vouchSlashed: m.vouch_slashed,
      feePaid: m.fee_paid, feeEarned: m.fee_earned, credited: m.credited, short: m.short,
      collateralRefunded: m.refunded, deposited: a.deposited, withdrawn: a.withdrawn, net: a.withdrawn - a.deposited,
    });
  }
  const voucherNames = [...new Set(vouches.map((v) => v.voucher))];
  for (const account of voucherNames) {
    const a = book(account);
    const slashed = circle.slots
      .flatMap((member) => circle.members[member].vouches)
      .filter((v) => v.voucher === account)
      .reduce((sum, v) => sum + v.slashed, 0n);
    ledger.push({
      account, role: 'voucher', slashed, deposited: a.deposited, withdrawn: a.withdrawn, net: a.withdrawn - a.deposited,
    });
  }

  return {
    circle,
    start,
    rounds,
    closing,
    ledger,
    accounts,
    totals: {
      escrow: circle.escrow,
      shortfall: circle.shortfall,
      netSum: ledger.reduce((sum, row) => sum + row.net, 0n),
    },
  };
}

/**
 * The classic attack: the member in `walkerSlot` pays until they collect the
 * pot, then disappears. Returns the attacked run next to the all-honest
 * baseline so each member can be compared against what they would have had.
 */
export function simulateWalkAway({
  n = 5,
  contribution,
  coverageBps = 10000,
  orderFeeBps = 100,
  walkerSlot = 1,
  vouches = [],
  names = DEMO_NAMES,
}) {
  const base = { n, contribution, coverageBps, orderFeeBps, names };
  const baseline = runScenario(base);
  const attacked = runScenario({
    ...base,
    vouches,
    pays: (slot, round) => slot !== walkerSlot || round <= walkerSlot,
  });
  const walker = names[walkerSlot - 1];
  const ledger = attacked.ledger.map((row) => {
    const honest = baseline.ledger.find((b) => b.account === row.account);
    const baselineNet = honest ? honest.net : 0n;
    return { ...row, baselineNet, madeWhole: row.net >= baselineNet, isWalker: row.account === walker };
  });
  const walkerRow = ledger.find((row) => row.isWalker);
  const backers = ledger.filter((row) => row.role === 'voucher');
  return {
    walker,
    walkerSlot,
    baseline,
    attacked,
    ledger,
    walkerNet: walkerRow.net,
    /** The walker and the people who vouched for them, taken together. */
    walkerSideNet: walkerRow.net + backers.reduce((sum, row) => sum + row.net, 0n),
    othersMadeWhole: ledger.filter((row) => row.role === 'member' && !row.isWalker).every((row) => row.madeWhole),
    shortfall: attacked.totals.shortfall,
  };
}
