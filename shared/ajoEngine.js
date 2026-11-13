/**
 * Ajo Bridge — circle state machine.
 *
 * A pure, deterministic reducer for one savings circle. It never touches the
 * chain: every function takes the circle object plus explicit inputs (who,
 * how much was attached, what time it is) and returns the side effects the
 * host must perform:
 *
 *   { transfers: [{ to, amount, reason }], events: [{ event, data }] }
 *
 * Hosts:
 *   - contract/src/contract.js   executes `transfers` as NEAR transfers and logs `events`
 *   - shared/simulate.js         tallies them into a ledger (tests, `npm run demo`)
 *   - web demo mode              runs a seeded circle locally with the very same rules
 *
 * There is deliberately no "withdraw" operation. Money only leaves a circle as
 * a payout to the round's recipient, a debt repayment to a short-paid member, a
 * refund of somebody's own deposit, or a share of the fee pool.
 */

import { coverageTarget, feeWeights, slotCollateral, slotFee, splitByWeights, big } from './ajoMath.js';

export const STATUS = Object.freeze({
  OPEN: 'OPEN', // collecting members and collateral
  ACTIVE: 'ACTIVE', // rounds are running
  AWAITING_FINALIZE: 'AWAITING_FINALIZE', // every round is paid out, refunds pending
  COMPLETED: 'COMPLETED',
});

export const LIMITS = Object.freeze({
  MIN_MEMBERS: 2,
  MAX_MEMBERS: 12,
  MAX_COVERAGE_BPS: 10000,
  MAX_ORDER_FEE_BPS: 2000,
  /** A joining member must put down at least this share of S_k themselves (anti slot-squatting). */
  MIN_RESERVE_BPS: 1000,
  MAX_VOUCHERS_PER_MEMBER: 4,
  MAX_NAME_LENGTH: 48,
  MIN_ROUND_NS: 30n * 1_000_000_000n,
  MAX_ROUND_NS: 366n * 24n * 3600n * 1_000_000_000n,
  HISTORY_CAP: 60,
});

/** Keys whose values are BigInt in memory and decimal strings in JSON. */
const BIGINT_KEYS = new Set([
  'contribution', 'round_ns', 'deadline_ns', 'created_ns', 'started_ns', 'at_ns',
  'pot', 'fee_pool', 'escrow', 'shortfall',
  'stake', 'amount', 'slashed', 'vouch_slashed', 'contributed', 'received',
  'fee', 'fee_paid', 'fee_earned', 'topup', 'repaid', 'credited', 'short', 'refunded', 'paid',
]);

export function serializeCircle(circle) {
  return JSON.stringify(circle, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
}

export function deserializeCircle(json) {
  return JSON.parse(json, (key, value) =>
    BIGINT_KEYS.has(key) && typeof value === 'string' ? BigInt(value) : value,
  );
}

function fail(message) {
  throw new Error(message);
}

function effects() {
  return { transfers: [], events: [] };
}

function termsOf(circle) {
  return {
    n: circle.n,
    contribution: circle.contribution,
    coverageBps: circle.coverage_bps,
    orderFeeBps: circle.order_fee_bps,
  };
}

const minBig = (a, b) => (a < b ? a : b);
const maxBig = (a, b) => (a > b ? a : b);

/** Money leaving the circle. Zero-value transfers are dropped. */
function pay(circle, out, to, amount, reason) {
  if (amount <= 0n) return;
  circle.escrow -= amount;
  out.transfers.push({ to, amount, reason });
}

/** Record an event for the host (NEP-297 log) and in the circle's capped on-chain history. */
function emit(circle, out, now, event, data = {}) {
  out.events.push({ event, data: { circle_id: circle.id, round: circle.round, ...data } });
  const entry = { t: now.toString(), e: event, r: circle.round };
  if (data.account !== undefined) entry.a = data.account;
  if (data.amount !== undefined) entry.x = data.amount.toString();
  if (data.by !== undefined) entry.b = data.by;
  circle.history.push(entry);
  if (circle.history.length > LIMITS.HISTORY_CAP) circle.history.splice(0, circle.history.length - LIMITS.HISTORY_CAP);
}

export function vouchedTotal(member) {
  return member.vouches.reduce((sum, v) => sum + v.amount, 0n);
}

/** Collateral currently backing a member: their own stake plus what vouchers put up. */
export function collateralOf(member) {
  return member.stake + vouchedTotal(member);
}

export function requiredCollateral(circle, slot) {
  return slotCollateral(termsOf(circle), slot);
}

export function minReserve(circle, slot) {
  const required = requiredCollateral(circle, slot);
  return (required * BigInt(LIMITS.MIN_RESERVE_BPS) + 9999n) / 10000n;
}

export function membersInSlotOrder(circle) {
  return circle.slots.filter(Boolean).map((account) => circle.members[account]);
}

export function currentRecipient(circle) {
  if (circle.status !== STATUS.ACTIVE) return null;
  return circle.members[circle.slots[circle.round - 1]];
}

/** Own-property lookup, so names such as "constructor" can never resolve to Object.prototype. */
export function getMember(circle, account) {
  return Object.prototype.hasOwnProperty.call(circle.members, account) ? circle.members[account] : null;
}

function memberOrFail(circle, account) {
  return getMember(circle, account) ?? fail(`${account} is not a member of circle ${circle.id}`);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * @param {object} p
 * @param {number|string} p.id
 * @param {string} p.creator
 * @param {string} [p.name]
 * @param {number} p.n                 members = rounds = slots
 * @param {bigint|string} p.contribution   C, per member per round
 * @param {number} p.coverageBps       10000 = strangers (full cover), 5000 = friends
 * @param {number} p.orderFeeBps       fair-order fee rate
 * @param {bigint|string} p.roundNs    length of one round in nanoseconds
 * @param {bigint|string} p.now        current time in nanoseconds
 */
export function createCircle(p) {
  const n = Number(p.n);
  const contribution = big(p.contribution);
  const coverageBps = Number(p.coverageBps);
  const orderFeeBps = Number(p.orderFeeBps);
  const roundNs = big(p.roundNs);
  const now = big(p.now);
  const name = String(p.name ?? '').trim() || `Circle ${p.id}`;

  if (!Number.isInteger(n) || n < LIMITS.MIN_MEMBERS || n > LIMITS.MAX_MEMBERS) {
    fail(`members must be an integer between ${LIMITS.MIN_MEMBERS} and ${LIMITS.MAX_MEMBERS}`);
  }
  if (contribution <= 0n) fail('contribution must be positive');
  if (!Number.isInteger(coverageBps) || coverageBps < 0 || coverageBps > LIMITS.MAX_COVERAGE_BPS) {
    fail(`coverage_bps must be an integer between 0 and ${LIMITS.MAX_COVERAGE_BPS}`);
  }
  if (!Number.isInteger(orderFeeBps) || orderFeeBps < 0 || orderFeeBps > LIMITS.MAX_ORDER_FEE_BPS) {
    fail(`order_fee_bps must be an integer between 0 and ${LIMITS.MAX_ORDER_FEE_BPS}`);
  }
  if (roundNs < LIMITS.MIN_ROUND_NS || roundNs > LIMITS.MAX_ROUND_NS) fail('round length out of range');
  if (name.length > LIMITS.MAX_NAME_LENGTH) fail(`name must be at most ${LIMITS.MAX_NAME_LENGTH} characters`);

  const circle = {
    id: p.id,
    name,
    creator: p.creator,
    n,
    contribution,
    coverage_bps: coverageBps,
    order_fee_bps: orderFeeBps,
    round_ns: roundNs,
    status: STATUS.OPEN,
    round: 0,
    deadline_ns: 0n,
    created_ns: now,
    started_ns: 0n,
    slots: Array.from({ length: n }, () => null),
    members: {},
    pot: 0n,
    fee_pool: 0n,
    escrow: 0n,
    shortfall: 0n,
    rounds: [],
    history: [],
    notes: [],
  };
  const out = effects();
  emit(circle, out, now, 'circle_created', {
    account: p.creator,
    name,
    members: n,
    contribution: contribution.toString(),
    coverage_bps: coverageBps,
    order_fee_bps: orderFeeBps,
    round_ns: roundNs.toString(),
  });
  return { circle, ...out };
}

// ---------------------------------------------------------------------------
// Before the start: join, vouch, cancel a vouch, leave
// ---------------------------------------------------------------------------

function maybeStart(circle, out, now) {
  if (circle.status !== STATUS.OPEN) return;
  if (circle.slots.some((account) => account === null)) return;
  const funded = membersInSlotOrder(circle).every((m) => collateralOf(m) >= requiredCollateral(circle, m.slot));
  if (!funded) return;
  circle.status = STATUS.ACTIVE;
  circle.round = 1;
  circle.started_ns = now;
  circle.deadline_ns = now + circle.round_ns;
  emit(circle, out, now, 'circle_started', { deadline_ns: circle.deadline_ns.toString() });
}

/**
 * Take an open payout slot. `deposit` is the member's own collateral: at least
 * MIN_RESERVE of S_k, at most S_k (anything above is refunded). A voucher can
 * fill the rest. The circle starts when all slots are taken and fully backed.
 *
 * A member who already holds the slot can call join again to add to their own
 * stake, for example when a backer pulled out before the start.
 */
export function join(circle, { account, slot, deposit, now }) {
  const attached = big(deposit);
  const at = big(now);
  if (circle.status !== STATUS.OPEN) fail('circle already started: joining is closed');
  if (!Number.isInteger(slot) || slot < 1 || slot > circle.n) fail(`slot must be between 1 and ${circle.n}`);
  const existing = getMember(circle, account);
  if (existing) return addStake(circle, existing, { slot, attached, at });
  if (circle.slots[slot - 1] !== null) fail(`slot ${slot} is already taken`);
  const required = requiredCollateral(circle, slot);
  const reserve = minReserve(circle, slot);
  if (attached < reserve) fail(`attach at least ${reserve} to reserve slot ${slot} (full collateral is ${required})`);

  const out = effects();
  circle.escrow += attached;
  const stake = minBig(attached, required);
  circle.slots[slot - 1] = account;
  circle.members[account] = {
    account,
    slot,
    stake,
    vouches: [],
    last_paid_round: 0,
    paid_out: false,
    defaulted: false,
    missed: 0,
    contributed: 0n,
    received: 0n,
    slashed: 0n,
    vouch_slashed: 0n,
    fee_paid: 0n,
    fee_earned: 0n,
    topup: 0n,
    repaid: 0n,
    credited: 0n,
    short: 0n,
    refunded: 0n,
    owes: [],
  };
  emit(circle, out, at, 'member_joined', { account, slot, amount: stake, required: required.toString() });
  pay(circle, out, account, attached - stake, 'excess_refund');
  maybeStart(circle, out, at);
  return out;
}

function addStake(circle, member, { slot, attached, at }) {
  if (slot !== member.slot) fail(`${member.account} already holds slot ${member.slot}`);
  const gap = requiredCollateral(circle, member.slot) - collateralOf(member);
  if (gap <= 0n) fail(`slot ${member.slot} is already fully collateralised`);
  if (attached <= 0n) fail('attach the collateral you want to add');
  const out = effects();
  circle.escrow += attached;
  const accepted = minBig(attached, gap);
  member.stake += accepted;
  emit(circle, out, at, 'stake_added', { account: member.account, slot: member.slot, amount: accepted });
  pay(circle, out, member.account, attached - accepted, 'excess_refund');
  maybeStart(circle, out, at);
  return out;
}

/**
 * Back a member by filling part or all of the collateral they have not put up
 * themselves. A voucher's stake is slashed before the member's own. A vouch can
 * only fill the gap: it never displaces the member's own stake, so nobody can
 * push a member out of their collateral and then cancel.
 */
export function vouch(circle, { voucher, member: memberAccount, deposit, now }) {
  const attached = big(deposit);
  const at = big(now);
  if (circle.status !== STATUS.OPEN) fail('circle already started: vouching is closed');
  const member = memberOrFail(circle, memberAccount);
  if (voucher === memberAccount) fail('you cannot vouch for yourself: call join again to add your own collateral');
  if (attached <= 0n) fail('attach the amount you want to vouch');
  const gap = requiredCollateral(circle, member.slot) - collateralOf(member);
  if (gap <= 0n) fail(`${memberAccount} is already fully collateralised`);

  const existing = member.vouches.find((v) => v.voucher === voucher);
  if (!existing && member.vouches.length >= LIMITS.MAX_VOUCHERS_PER_MEMBER) {
    fail('this member already has the maximum number of vouchers');
  }

  const out = effects();
  circle.escrow += attached;
  const accepted = minBig(attached, gap);
  if (existing) existing.amount += accepted;
  else member.vouches.push({ voucher, amount: accepted, slashed: 0n });
  emit(circle, out, at, 'vouched', { account: memberAccount, by: voucher, amount: accepted });
  pay(circle, out, voucher, attached - accepted, 'excess_refund');
  maybeStart(circle, out, at);
  return out;
}

/** A voucher can pull their vouch back any time before the circle starts. */
export function cancelVouch(circle, { voucher, member: memberAccount, now }) {
  const at = big(now);
  if (circle.status !== STATUS.OPEN) fail('circle already started: vouches are locked until the end');
  const member = memberOrFail(circle, memberAccount);
  const index = member.vouches.findIndex((v) => v.voucher === voucher);
  if (index === -1) fail(`${voucher} has no vouch for ${memberAccount}`);
  const out = effects();
  const [removed] = member.vouches.splice(index, 1);
  emit(circle, out, at, 'vouch_cancelled', { account: memberAccount, by: voucher, amount: removed.amount });
  pay(circle, out, voucher, removed.amount, 'vouch_refund');
  return out;
}

/** Leave before the start: the member and all of their vouchers are refunded in full. */
export function leave(circle, { account, now }) {
  const at = big(now);
  if (circle.status !== STATUS.OPEN) fail('circle already started: leaving is closed');
  const member = memberOrFail(circle, account);
  const out = effects();
  emit(circle, out, at, 'member_left', { account, slot: member.slot, amount: member.stake });
  pay(circle, out, account, member.stake, 'stake_refund');
  for (const v of member.vouches) pay(circle, out, v.voucher, v.amount, 'vouch_refund');
  circle.slots[member.slot - 1] = null;
  delete circle.members[account];
  return out;
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

/**
 * Pay this round's contribution C. When the last member pays, the round's
 * recipient is paid in the same call.
 */
export function contribute(circle, { account, deposit, now }) {
  const attached = big(deposit);
  const at = big(now);
  if (circle.status !== STATUS.ACTIVE) fail('circle is not running a round');
  const member = memberOrFail(circle, account);
  if (member.last_paid_round >= circle.round) fail(`already contributed to round ${circle.round}`);
  if (attached < circle.contribution) fail(`attach the contribution of ${circle.contribution}`);

  const out = effects();
  circle.escrow += attached;
  circle.pot += circle.contribution;
  member.contributed += circle.contribution;
  member.last_paid_round = circle.round;
  emit(circle, out, at, 'contributed', { account, amount: circle.contribution });
  pay(circle, out, account, attached - circle.contribution, 'excess_refund');

  const everyonePaid = membersInSlotOrder(circle).every((m) => m.last_paid_round === circle.round);
  if (everyonePaid) completeRound(circle, out, at, { missed: [], netted: false, early: true });
  return out;
}

/**
 * After the deadline anyone may settle the round. Every member who has not
 * paid is slashed by C (vouchers first, then their own stake). What collateral
 * cannot cover is written down as owed to this round's recipient.
 *
 * The recipient's own missed contribution is not slashed: it is simply netted
 * out of the payout they are about to receive.
 */
export function settleRound(circle, { now }) {
  const at = big(now);
  if (circle.status !== STATUS.ACTIVE) fail('circle is not running a round');
  if (at < circle.deadline_ns) fail('round deadline has not passed yet');

  const out = effects();
  const recipient = currentRecipient(circle);
  const missed = [];
  let netted = false;
  for (const member of membersInSlotOrder(circle)) {
    if (member.last_paid_round === circle.round) continue;
    if (member.account === recipient.account) {
      netted = true;
      emit(circle, out, at, 'contribution_netted', { account: member.account, amount: circle.contribution });
      continue;
    }
    missed.push(member.account);
    slash(circle, out, at, member, recipient);
  }
  completeRound(circle, out, at, { missed, netted, early: false });
  return out;
}

function slash(circle, out, now, member, recipient) {
  let need = circle.contribution;
  let fromVouchers = 0n;
  for (const v of member.vouches) {
    if (need === 0n) break;
    const take = minBig(v.amount, need);
    if (take === 0n) continue;
    v.amount -= take;
    v.slashed += take;
    fromVouchers += take;
    need -= take;
    emit(circle, out, now, 'voucher_slashed', { account: member.account, by: v.voucher, amount: take });
  }
  member.vouch_slashed += fromVouchers;
  const fromStake = minBig(member.stake, need);
  member.stake -= fromStake;
  member.slashed += fromStake;
  need -= fromStake;

  circle.pot += circle.contribution - need;
  member.missed += 1;
  member.defaulted = true;
  if (need > 0n) {
    // Not paid yet  -> a debt, deducted from the member's own future payout.
    // Already paid  -> a group shortfall; only a forfeited fee share can still repay it.
    member.owes.push({ to: recipient.account, amount: need, round: circle.round });
    recipient.short += need;
    circle.shortfall += need;
  }
  emit(circle, out, now, 'member_slashed', {
    account: member.account,
    amount: fromStake,
    from_vouchers: fromVouchers.toString(),
    uncovered: need.toString(),
    recoverable: !member.paid_out,
  });
}

/**
 * Pay creditors of `debtor` from `available`, oldest debt first. Returns what is left.
 * Terminates because every step strictly reduces the circle's total outstanding debt.
 */
function repayOwed(circle, out, debtor, available, reason) {
  let rest = available;
  while (rest > 0n && debtor.owes.length > 0) {
    const owed = debtor.owes[0];
    const x = minBig(owed.amount, rest);
    owed.amount -= x;
    if (owed.amount === 0n) debtor.owes.shift();
    rest -= x;
    debtor.repaid += x;
    circle.shortfall -= x;
    const creditor = circle.members[owed.to];
    creditor.credited += x;
    creditor.short -= x;
    payMember(circle, out, creditor, x, reason);
  }
  return rest;
}

/**
 * Money due to a member. A member who is in debt receives nothing until their
 * creditors are repaid: whatever is due to them is passed on first.
 */
function payMember(circle, out, member, amount, reason) {
  const rest = member.owes.length > 0 ? repayOwed(circle, out, member, amount, 'debt_repaid') : amount;
  pay(circle, out, member.account, rest, reason);
}

function completeRound(circle, out, now, { missed, netted, early }) {
  const terms = termsOf(circle);
  const round = circle.round;
  const recipient = currentRecipient(circle);
  const pot = circle.pot;
  circle.pot = 0n;

  // 1. Fair-order fee goes to the pool shared by the members who wait.
  const fee = minBig(slotFee(terms, recipient.slot), pot);
  circle.fee_pool += fee;
  recipient.fee_paid += fee;
  let rest = pot - fee;

  // 2. Debts from rounds the recipient missed before their turn are repaid first.
  const beforeRepay = rest;
  rest = repayOwed(circle, out, recipient, rest, 'debt_repaid');
  const repaid = beforeRepay - rest;

  // 3. Top-up: the recipient's collateral is refilled from their own payout until
  //    it again covers what they still owe. Missing payments early cannot be used
  //    to burn the collateral down before collecting the pot.
  const deficit = coverageTarget(terms, recipient.slot) - collateralOf(recipient);
  const topup = deficit > 0n ? minBig(deficit, rest) : 0n;
  recipient.stake += topup;
  recipient.topup += topup;
  rest -= topup;

  // 4. The remainder is paid out immediately.
  recipient.received += rest;
  recipient.paid_out = true;
  circle.rounds.push({
    round,
    recipient: recipient.account,
    pot,
    fee,
    repaid,
    topup,
    paid: rest,
    missed,
    netted,
    early,
    at_ns: now,
  });
  emit(circle, out, now, 'round_paid', {
    account: recipient.account,
    amount: rest,
    pot: pot.toString(),
    fee: fee.toString(),
    repaid: repaid.toString(),
    topup: topup.toString(),
    missed,
  });
  payMember(circle, out, recipient, rest, 'payout');

  if (round === circle.n) {
    circle.status = STATUS.AWAITING_FINALIZE;
    circle.deadline_ns = 0n;
    emit(circle, out, now, 'rounds_complete', {});
  } else {
    circle.round = round + 1;
    circle.deadline_ns = now + circle.round_ns;
    emit(circle, out, now, 'round_started', { deadline_ns: circle.deadline_ns.toString() });
  }
}

// ---------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------

/**
 * Close the circle once every round is paid out:
 *   - the fee pool is shared by waiting time (slot j has weight j − 1);
 *   - a member who missed any payment forfeits their share. Forfeited fees first
 *     repay anyone who was left short, the rest goes to the members who never
 *     missed (if nobody stayed honest, fees are handed back to those who paid them);
 *   - remaining collateral is refunded to members and vouchers.
 */
export function finalize(circle, { now }) {
  const at = big(now);
  if (circle.status === STATUS.COMPLETED) fail('circle is already finalized');
  if (circle.status !== STATUS.AWAITING_FINALIZE) fail('rounds are still running: nothing to finalize yet');

  const out = effects();
  const members = membersInSlotOrder(circle);
  const weights = feeWeights(circle.n);
  const shares = splitByWeights(circle.fee_pool, weights);

  // Defaulters forfeit their share into one pot...
  let forfeited = 0n;
  members.forEach((member, i) => {
    if (!member.defaulted) return;
    forfeited += shares[i];
    shares[i] = 0n;
  });
  // ...which first makes whole anyone who was left short...
  const usedForOwnDebt = members.map((member) => {
    const left = repayOwed(circle, out, member, forfeited, 'shortfall_repaid_from_forfeited_fees');
    const used = forfeited - left;
    forfeited = left;
    return used;
  });
  // ...and only then rewards the members who never missed.
  if (forfeited > 0n) {
    const honest = members.map((m) => !m.defaulted);
    const bonus = honest.some(Boolean)
      ? splitAmongEligible(forfeited, weights, honest)
      // Nobody stayed honest: hand fees back to whoever paid them, pro rata, net of
      // what the pool already paid on their behalf.
      : splitByWeights(forfeited, members.map((m, i) => maxBig(0n, m.fee_paid - usedForOwnDebt[i])));
    bonus.forEach((x, i) => { shares[i] += x; });
  }

  members.forEach((member, i) => {
    const refund = member.stake;
    member.stake = 0n;
    member.refunded += refund;
    member.fee_earned = shares[i];
    payMember(circle, out, member, refund + shares[i], 'collateral_refund_and_fee_share');
    for (const v of member.vouches) {
      pay(circle, out, v.voucher, v.amount, 'vouch_refund');
      v.amount = 0n;
    }
  });

  circle.fee_pool = 0n;
  circle.status = STATUS.COMPLETED;
  emit(circle, out, at, 'circle_completed', { shortfall: circle.shortfall.toString() });
  return out;
}

/** splitByWeights restricted to eligible indexes (equal split if their weights are all zero). */
function splitAmongEligible(amount, weights, eligible) {
  const indexes = eligible.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
  const parts = splitByWeights(amount, indexes.map((i) => weights[i]));
  const result = weights.map(() => 0n);
  indexes.forEach((index, j) => { result[index] = parts[j]; });
  return result;
}

// ---------------------------------------------------------------------------
// Read helpers (shared by contract views, the agent and the UI)
// ---------------------------------------------------------------------------

export function quoteSlot(circle, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > circle.n) fail(`slot must be between 1 and ${circle.n}`);
  const terms = termsOf(circle);
  const fee = slotFee(terms, slot);
  const pot = BigInt(circle.n) * circle.contribution;
  let pool = 0n;
  for (let k = 1; k <= circle.n; k++) pool += slotFee(terms, k);
  const feeShare = splitByWeights(pool, feeWeights(circle.n))[slot - 1];
  return {
    slot,
    taken_by: circle.slots[slot - 1],
    collateral: requiredCollateral(circle, slot),
    min_reserve: minReserve(circle, slot),
    fee,
    fee_share: feeShare,
    owed_after_payout: BigInt(circle.n - slot) * circle.contribution,
    payout: pot - fee,
  };
}

/** Who has not paid the current round yet (empty when no round is running). */
export function unpaidMembers(circle) {
  if (circle.status !== STATUS.ACTIVE) return [];
  return membersInSlotOrder(circle)
    .filter((m) => m.last_paid_round < circle.round)
    .map((m) => m.account);
}
