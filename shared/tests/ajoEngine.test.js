import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS, STATUS, cancelVouch, collateralOf, contribute, createCircle, deserializeCircle, finalize, join, leave,
  minReserve, quoteSlot, requiredCollateral, serializeCircle, settleRound, unpaidMembers, vouch,
} from '../ajoEngine.js';
import { feeShares, slotFee, walkAwayPayoff } from '../ajoMath.js';
import { runScenario, simulateWalkAway } from '../simulate.js';

const C = 2000n;
const SECOND = 1_000_000_000n;
const ROUND = 60n * SECOND;
const T0 = 1_000n * SECOND;
const names = ['ada', 'bayo', 'chidi', 'dupe', 'emeka'];

function newCircle(overrides = {}) {
  return createCircle({
    id: 7, creator: 'ada', name: 'Market women', n: 5, contribution: C, coverageBps: 10000, orderFeeBps: 100,
    roundNs: ROUND, now: T0, ...overrides,
  }).circle;
}

function fill(circle, now = T0) {
  for (let slot = 1; slot <= circle.n; slot++) {
    join(circle, { account: names[slot - 1], slot, deposit: requiredCollateral(circle, slot), now });
  }
  return circle;
}

const sent = (fx, to) => fx.transfers.filter((t) => t.to === to).reduce((sum, t) => sum + t.amount, 0n);

// ---------------------------------------------------------------- creation

test('createCircle validates its terms', () => {
  assert.throws(() => newCircle({ n: 1 }), /members/);
  assert.throws(() => newCircle({ n: LIMITS.MAX_MEMBERS + 1 }), /members/);
  assert.throws(() => newCircle({ contribution: 0n }), /contribution/);
  assert.throws(() => newCircle({ coverageBps: 10001 }), /coverage_bps/);
  assert.throws(() => newCircle({ orderFeeBps: LIMITS.MAX_ORDER_FEE_BPS + 1 }), /order_fee_bps/);
  assert.throws(() => newCircle({ roundNs: SECOND }), /round length/);
  assert.throws(() => newCircle({ name: 'x'.repeat(49) }), /name/);
  const circle = newCircle();
  assert.equal(circle.status, STATUS.OPEN);
  assert.deepEqual(circle.slots, [null, null, null, null, null]);
});

// ---------------------------------------------------------------- joining

test('join: first come first served, collateral is slot-priced, excess is refunded', () => {
  const circle = newCircle();
  assert.equal(quoteSlot(circle, 1).collateral, 8000n);
  assert.equal(quoteSlot(circle, 5).collateral, 2000n);

  const fx = join(circle, { account: 'ada', slot: 1, deposit: 9000n, now: T0 });
  assert.equal(circle.members.ada.stake, 8000n);
  assert.equal(sent(fx, 'ada'), 1000n, 'anything above S_k goes straight back');
  assert.equal(circle.escrow, 8000n);

  assert.throws(() => join(circle, { account: 'bayo', slot: 1, deposit: 8000n, now: T0 }), /already taken/);
  assert.throws(() => join(circle, { account: 'ada', slot: 2, deposit: 6000n, now: T0 }), /already holds slot 1/);
  assert.throws(() => join(circle, { account: 'bayo', slot: 6, deposit: 1n, now: T0 }), /slot must be/);
  assert.equal(minReserve(circle, 2), 600n);
  assert.throws(() => join(circle, { account: 'bayo', slot: 2, deposit: 599n, now: T0 }), /attach at least 600/);
});

test('the circle starts only when every slot is taken and fully collateralised', () => {
  const circle = newCircle();
  for (let slot = 1; slot <= 4; slot++) {
    join(circle, { account: names[slot - 1], slot, deposit: requiredCollateral(circle, slot), now: T0 });
  }
  assert.equal(circle.status, STATUS.OPEN);
  join(circle, { account: 'emeka', slot: 5, deposit: 500n, now: T0 + 5n });
  assert.equal(circle.status, STATUS.OPEN, 'slot 5 is reserved but not fully backed yet');
  vouch(circle, { voucher: 'uncle.london', member: 'emeka', deposit: 1500n, now: T0 + 9n });
  assert.equal(circle.status, STATUS.ACTIVE);
  assert.equal(circle.round, 1);
  assert.equal(circle.deadline_ns, T0 + 9n + ROUND);
  assert.throws(() => join(circle, { account: 'zed', slot: 1, deposit: 8000n, now: T0 }), /joining is closed/);
  assert.throws(() => leave(circle, { account: 'ada', now: T0 }), /leaving is closed/);
  assert.throws(() => vouch(circle, { voucher: 'x', member: 'ada', deposit: 1n, now: T0 }), /vouching is closed/);
});

test('leave before start refunds the member and their vouchers in full', () => {
  const circle = newCircle();
  join(circle, { account: 'ada', slot: 1, deposit: 3000n, now: T0 });
  vouch(circle, { voucher: 'uncle.london', member: 'ada', deposit: 5000n, now: T0 });
  const fx = leave(circle, { account: 'ada', now: T0 });
  assert.equal(sent(fx, 'ada'), 3000n);
  assert.equal(sent(fx, 'uncle.london'), 5000n);
  assert.equal(circle.escrow, 0n);
  assert.equal(circle.slots[0], null);
  assert.equal(circle.members.ada, undefined);
  assert.throws(() => leave(circle, { account: 'ada', now: T0 }), /not a member/);
});

// ---------------------------------------------------------------- vouching

test('vouch fills only the gap: it never displaces the member\'s own stake', () => {
  const circle = newCircle();
  join(circle, { account: 'ada', slot: 1, deposit: 800n, now: T0 });
  const fx = vouch(circle, { voucher: 'uncle.london', member: 'ada', deposit: 9000n, now: T0 });
  assert.equal(sent(fx, 'uncle.london'), 1800n, 'only the missing 7200 is accepted');
  assert.equal(sent(fx, 'ada'), 0n);
  assert.equal(circle.members.ada.stake, 800n);
  assert.equal(collateralOf(circle.members.ada), 8000n);
  assert.throws(() => vouch(circle, { voucher: 'aunt', member: 'ada', deposit: 1n, now: T0 }), /fully collateralised/);
  assert.throws(() => vouch(circle, { voucher: 'ada', member: 'ada', deposit: 1n, now: T0 }), /yourself/);
  assert.throws(() => vouch(circle, { voucher: 'aunt', member: 'nobody', deposit: 1n, now: T0 }), /not a member/);
  assert.throws(() => vouch(circle, { voucher: 'aunt', member: 'constructor', deposit: 1n, now: T0 }), /not a member/);
});

test('a member can add to their own stake by joining their slot again (backer pulled out)', () => {
  const circle = newCircle();
  join(circle, { account: 'ada', slot: 1, deposit: 800n, now: T0 });
  vouch(circle, { voucher: 'uncle.london', member: 'ada', deposit: 7200n, now: T0 });
  assert.throws(() => join(circle, { account: 'ada', slot: 1, deposit: 1n, now: T0 }), /already fully collateralised/);
  cancelVouch(circle, { voucher: 'uncle.london', member: 'ada', now: T0 });
  assert.equal(collateralOf(circle.members.ada), 800n, 'the cancelled vouch leaves the member\'s own stake alone');
  assert.throws(() => join(circle, { account: 'ada', slot: 2, deposit: 100n, now: T0 }), /already holds slot 1/);
  assert.throws(() => join(circle, { account: 'ada', slot: 1, deposit: 0n, now: T0 }), /attach the collateral/);
  const fx = join(circle, { account: 'ada', slot: 1, deposit: 8000n, now: T0 });
  assert.equal(circle.members.ada.stake, 8000n);
  assert.equal(sent(fx, 'ada'), 800n, 'anything above S_k is refunded');
  assert.equal(circle.escrow, 8000n);
});

test('vouch: several vouchers, capped; cancelVouch refunds before the start', () => {
  const circle = newCircle();
  join(circle, { account: 'ada', slot: 1, deposit: 800n, now: T0 });
  for (let i = 0; i < LIMITS.MAX_VOUCHERS_PER_MEMBER; i++) {
    vouch(circle, { voucher: `backer${i}`, member: 'ada', deposit: 100n, now: T0 });
  }
  vouch(circle, { voucher: 'backer0', member: 'ada', deposit: 50n, now: T0 });
  assert.equal(circle.members.ada.vouches[0].amount, 150n);
  const before = circle.escrow;
  assert.throws(() => vouch(circle, { voucher: 'one-too-many', member: 'ada', deposit: 100n, now: T0 }), /maximum number/);
  assert.equal(circle.escrow, before, 'a rejected vouch leaves the books untouched');

  const fx = cancelVouch(circle, { voucher: 'backer0', member: 'ada', now: T0 });
  assert.equal(sent(fx, 'backer0'), 150n);
  assert.throws(() => cancelVouch(circle, { voucher: 'backer0', member: 'ada', now: T0 }), /no vouch/);
});

// ---------------------------------------------------------------- rounds

test('contribute: exact C per round, once, members only; last payment triggers the payout', () => {
  const circle = fill(newCircle());
  assert.throws(() => contribute(circle, { account: 'zed', deposit: C, now: T0 }), /not a member/);
  assert.throws(() => contribute(circle, { account: 'ada', deposit: C - 1n, now: T0 }), /attach the contribution/);
  const first = contribute(circle, { account: 'ada', deposit: C + 5n, now: T0 });
  assert.equal(sent(first, 'ada'), 5n);
  assert.throws(() => contribute(circle, { account: 'ada', deposit: C, now: T0 }), /already contributed/);
  assert.deepEqual(unpaidMembers(circle), ['bayo', 'chidi', 'dupe', 'emeka']);
  assert.throws(() => settleRound(circle, { now: T0 + ROUND - 1n }), /deadline has not passed/);

  let last;
  for (const account of ['bayo', 'chidi', 'dupe', 'emeka']) last = contribute(circle, { account, deposit: C, now: T0 + 10n });
  assert.equal(sent(last, 'ada'), 10000n - 80n, 'recipient gets pot minus F_1 in the same call');
  assert.equal(circle.round, 2);
  assert.equal(circle.fee_pool, 80n);
  assert.equal(circle.deadline_ns, T0 + 10n + ROUND);
  assert.equal(circle.rounds[0].early, true);
});

test('honest circle: everyone ends with exactly feeShare - fee and the circle holds nothing', () => {
  const terms = { n: 5, contribution: C, coverageBps: 10000, orderFeeBps: 100 };
  const run = runScenario(terms);
  assert.equal(run.circle.status, STATUS.COMPLETED);
  assert.equal(run.totals.escrow, 0n);
  assert.equal(run.totals.netSum, 0n);
  assert.deepEqual(run.ledger.map((row) => row.net), [-80n, -40n, 0n, 40n, 80n]);
  assert.deepEqual(run.ledger.map((row) => row.feeEarned), feeShares(terms));
  assert.ok(run.ledger.every((row) => !row.defaulted && row.slashed === 0n));
});

test('settle: a missed payment is slashed from the voucher first, then from the member', () => {
  const circle = newCircle();
  join(circle, { account: 'ada', slot: 1, deposit: 6500n, now: T0 });
  vouch(circle, { voucher: 'uncle.london', member: 'ada', deposit: 1500n, now: T0 });
  for (let slot = 2; slot <= 5; slot++) {
    join(circle, { account: names[slot - 1], slot, deposit: requiredCollateral(circle, slot), now: T0 });
  }
  // Round 1: everyone pays, ada collects. Round 2: ada is gone.
  for (const account of names) contribute(circle, { account, deposit: C, now: T0 });
  for (const account of ['bayo', 'chidi', 'dupe', 'emeka']) contribute(circle, { account, deposit: C, now: T0 });
  const fx = settleRound(circle, { now: circle.deadline_ns });
  const ada = circle.members.ada;
  assert.equal(ada.vouches[0].amount, 0n, 'voucher stake goes first');
  assert.equal(ada.vouches[0].slashed, 1500n);
  assert.equal(ada.slashed, 500n, 'then the member\'s own stake');
  assert.equal(ada.stake, 6000n);
  assert.equal(ada.defaulted, true);
  assert.equal(sent(fx, 'bayo'), 10000n - 60n, 'the recipient still receives a full pot');
  assert.deepEqual(circle.rounds[1].missed, ['ada']);
});

test('a recipient who skips their own round is netted, not slashed', () => {
  const circle = fill(newCircle());
  for (const account of ['bayo', 'chidi', 'dupe', 'emeka']) contribute(circle, { account, deposit: C, now: T0 });
  const fx = settleRound(circle, { now: circle.deadline_ns });
  assert.equal(sent(fx, 'ada'), 8000n - 80n);
  assert.equal(circle.members.ada.stake, 8000n);
  assert.equal(circle.members.ada.defaulted, false);
  assert.equal(circle.rounds[0].netted, true);
});

test('pre-payout default beyond collateral becomes a debt, repaid from the debtor\'s own payout', () => {
  // dupe (slot 4, collateral C) never pays. Round 1 eats her collateral, rounds 2 and 3 become debts.
  const run = runScenario({
    n: 5, contribution: C, coverageBps: 10000, orderFeeBps: 100, pays: (slot) => slot !== 4,
  });
  const [r1, r2, r3, r4] = run.rounds.map((r) => r.record);
  assert.equal(r1.paid, 10000n - 80n);
  assert.equal(r2.paid, 8000n - 60n, 'bayo is short-paid by C for now');
  assert.equal(r3.paid, 8000n - 40n);
  assert.equal(r4.repaid, 4000n, 'dupe\'s payout first repays bayo and chidi');
  assert.equal(r4.topup, 2000n, 'then refills her collateral for the round she still owes');
  const byName = Object.fromEntries(run.ledger.map((row) => [row.account, row]));
  assert.equal(byName.bayo.credited, 2000n);
  assert.equal(byName.chidi.credited, 2000n);
  assert.equal(run.totals.shortfall, 0n);
  assert.equal(run.totals.escrow, 0n);
  // Honest members end at least as well as in an all-honest circle (they share dupe's forfeited fee).
  const honest = runScenario({ n: 5, contribution: C, coverageBps: 10000, orderFeeBps: 100 });
  for (const row of run.ledger) {
    const baseline = honest.ledger.find((b) => b.account === row.account).net;
    if (row.account === 'dupe') assert.ok(row.net <= 0n, `dupe net ${row.net}`);
    else assert.ok(row.net >= baseline, `${row.account}: ${row.net} >= ${baseline}`);
  }
});

test('finalize: only after the last round, only once; defaulters forfeit their fee share', () => {
  const circle = fill(newCircle());
  assert.throws(() => finalize(circle, { now: T0 }), /still running/);
  const run = simulateWalkAway({ n: 5, contribution: C, walkerSlot: 2 });
  const byName = Object.fromEntries(run.ledger.map((row) => [row.account, row]));
  assert.equal(byName.bayo.feeEarned, 0n, 'the walker forfeits the 20 they would have earned');
  // 200 pool: nominal [0,20,40,60,80]; bayo's 20 is re-split by weight among slots 1,3,4,5 (0:2:3:4).
  assert.deepEqual(['ada', 'chidi', 'dupe', 'emeka'].map((a) => byName[a].feeEarned), [0n, 44n, 66n, 90n]);
  assert.throws(() => finalize(run.attacked.circle, { now: T0 }), /already finalized/);
});

// ---------------------------------------------------------------- the invariant

test('INVARIANT: full coverage — a member who walks away after their payout never gains, nobody else loses', () => {
  for (let n = 2; n <= 8; n++) {
    for (const orderFeeBps of [0, 100, 777, 2000]) {
      for (const contribution of [1n, 2000n, 10n ** 24n]) {
        const terms = { n, contribution, coverageBps: 10000, orderFeeBps };
        for (let walkerSlot = 1; walkerSlot <= n; walkerSlot++) {
          const label = `n=${n} fee=${orderFeeBps} C=${contribution} walker=slot ${walkerSlot}`;
          const sim = simulateWalkAway({ ...terms, walkerSlot });
          assert.ok(sim.walkerNet <= 0n || walkerSlot === n, `${label}: walker net ${sim.walkerNet} must be <= 0`);
          assert.equal(sim.walkerNet, walkAwayPayoff(terms, walkerSlot).net, `${label}: engine matches the closed form`);
          assert.ok(sim.othersMadeWhole, `${label}: every other member is at least as well off as with no default`);
          assert.equal(sim.shortfall, 0n, `${label}: no group shortfall`);
          assert.equal(sim.attacked.totals.escrow, 0n, `${label}: nothing is left in the circle`);
          assert.equal(sim.attacked.totals.netSum, 0n, `${label}: money is conserved`);
        }
      }
    }
  }
});

test('INVARIANT with a voucher: the backer takes the loss, the walker + backer side still never gains', () => {
  const terms = { n: 5, contribution: C, coverageBps: 10000, orderFeeBps: 100 };
  const sim = simulateWalkAway({
    ...terms, walkerSlot: 1, vouches: [{ slot: 1, voucher: 'uncle.london', amount: 8000n }],
  });
  const uncle = sim.ledger.find((row) => row.account === 'uncle.london');
  // ada reserves slot 1 with 10% (800); the backer can only fill the missing 7200.
  assert.equal(uncle.deposited - uncle.withdrawn, 7200n);
  assert.equal(uncle.slashed, 7200n, 'the voucher is slashed before the walker\'s own 800');
  assert.equal(sim.walkerNet, 7200n - 80n, 'the walker keeps most of the pot, at their backer\'s expense');
  assert.equal(sim.walkerSideNet, -80n, 'together they are exactly where a lone walker would be');
  assert.ok(sim.othersMadeWhole);
  assert.equal(sim.shortfall, 0n);
});

test('partial coverage (friends mode) is a real trade-off: the group can be left short', () => {
  const terms = { n: 5, contribution: C, coverageBps: 5000, orderFeeBps: 100 };
  const sim = simulateWalkAway({ ...terms, walkerSlot: 1 });
  assert.equal(sim.walkerNet, walkAwayPayoff(terms, 1).net);
  assert.equal(sim.walkerNet, 3920n);
  assert.equal(sim.shortfall, 4000n);
  assert.equal(sim.othersMadeWhole, false);
  const short = sim.ledger.filter((row) => row.short > 0n).map((row) => row.account);
  assert.deepEqual(short, ['dupe', 'emeka'], 'the last two recipients carry the loss');
  assert.equal(sim.attacked.totals.escrow, 0n);
});

test('a member in debt receives nothing until their creditors are repaid, even when most of the circle defaults', () => {
  // Only ada pays. Everyone else never contributes: 6 members, 20% order fee (worst case found by fuzzing).
  const terms = { n: 6, contribution: 1000n, coverageBps: 10000, orderFeeBps: 2000 };
  const run = runScenario({ ...terms, pays: (slot) => slot === 1 });
  const honest = runScenario(terms);
  const byName = Object.fromEntries(run.ledger.map((row) => [row.account, row]));
  assert.ok(byName.ada.net >= honest.ledger[0].net, 'the one honest member is not worse off');
  for (const row of run.ledger.slice(1)) assert.ok(row.net <= 0n, `${row.account} must not profit: ${row.net}`);
  assert.equal(run.totals.shortfall, 0n);
  assert.equal(run.totals.escrow, 0n);
});

// ---------------------------------------------------------------- randomised

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('PROPERTY: 5000 random default patterns at full coverage — honest members never lose, defaulters never gain', () => {
  const random = mulberry32(20261114);
  for (let i = 0; i < 5000; i++) {
    const n = 2 + Math.floor(random() * 9);
    const orderFeeBps = [0, 50, 100, 500, 2000][Math.floor(random() * 5)];
    const contribution = [1n, 7n, 2000n, 10n ** 24n][Math.floor(random() * 4)];
    const missRate = random();
    const flaky = Array.from({ length: n }, () => random() < 0.5);
    const pattern = Array.from({ length: n }, (_, s) =>
      Array.from({ length: n }, () => !(flaky[s] && random() < missRate)));
    const pays = (slot, round) => pattern[slot - 1][round - 1];
    const terms = { n, contribution, coverageBps: 10000, orderFeeBps };
    const label = `case ${i}: n=${n} fee=${orderFeeBps} C=${contribution} pattern=${JSON.stringify(pattern)}`;

    const baseline = runScenario(terms);
    const run = runScenario({ ...terms, pays });
    assert.equal(run.totals.escrow, 0n, `${label}: circle must end empty`);
    assert.equal(run.totals.netSum, 0n, `${label}: money is conserved`);
    for (const row of run.ledger) {
      const honestNet = baseline.ledger.find((b) => b.account === row.account).net;
      if (row.defaulted) {
        assert.ok(row.net <= 0n, `${label}: defaulter ${row.account} gained ${row.net}`);
        if (run.ledger.some((r) => !r.defaulted)) assert.equal(row.feeEarned, 0n, `${label}: defaulters forfeit`);
        else assert.ok(row.feeEarned <= row.feePaid, `${label}: with no honest member fees are only handed back`);
      } else {
        assert.ok(row.net >= honestNet, `${label}: honest ${row.account} got ${row.net}, baseline ${honestNet}`);
        assert.equal(row.short, 0n, `${label}: honest ${row.account} is still owed ${row.short}`);
      }
    }
    // A member who still owes money at the end has no collateral left (finalize relies on this).
    for (const account of run.circle.slots) {
      const m = run.circle.members[account];
      if (m.owes.length > 0) assert.equal(m.refunded, 0n, `${label}: ${account} was refunded while in debt`);
    }
  }
});

test('PROPERTY: 1000 random circles at any coverage — books always balance and nothing gets stuck', () => {
  const random = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const n = 2 + Math.floor(random() * 9);
    const coverageBps = Math.floor(random() * 10001);
    const orderFeeBps = Math.floor(random() * 2001);
    const contribution = BigInt(1 + Math.floor(random() * 5000));
    const pattern = Array.from({ length: n }, () => Array.from({ length: n }, () => random() < 0.7));
    const vouches = random() < 0.5
      ? [{ slot: 1 + Math.floor(random() * n), voucher: 'backer.one', amount: BigInt(1 + Math.floor(random() * 3000)) }]
      : [];
    const run = runScenario({
      n, contribution, coverageBps, orderFeeBps, vouches, pays: (slot, round) => pattern[slot - 1][round - 1],
    });
    const label = `case ${i}: n=${n} cov=${coverageBps} fee=${orderFeeBps} C=${contribution}`;
    assert.equal(run.circle.status, STATUS.COMPLETED, label);
    assert.equal(run.totals.escrow, 0n, `${label}: circle must end empty`);
    assert.equal(run.totals.netSum, 0n, `${label}: money is conserved`);
    const stillOwed = run.ledger.filter((r) => r.role === 'member').reduce((sum, r) => sum + r.short, 0n);
    assert.equal(stillOwed, run.totals.shortfall, `${label}: shortfall equals what members are still owed`);
    assert.ok(run.accounts['backer.one'] === undefined || run.accounts['backer.one'].withdrawn <= run.accounts['backer.one'].deposited,
      `${label}: a voucher can never withdraw more than they put in`);
  }
});

// ---------------------------------------------------------------- storage format

test('circles survive a JSON round-trip with BigInt amounts intact', () => {
  const circle = fill(newCircle());
  for (const account of ['ada', 'bayo']) contribute(circle, { account, deposit: C, now: T0 });
  settleRound(circle, { now: circle.deadline_ns });
  const json = serializeCircle(circle);
  assert.match(json, /"contribution":"2000"/, 'amounts are stored as decimal strings');
  const copy = deserializeCircle(json);
  assert.deepEqual(copy, circle);
  assert.equal(typeof copy.members.ada.stake, 'bigint');
  assert.equal(typeof copy.rounds[0].paid, 'bigint');
  assert.equal(serializeCircle(copy), json);
  assert.equal(slotFee({ n: copy.n, contribution: copy.contribution, coverageBps: copy.coverage_bps, orderFeeBps: copy.order_fee_bps }, 1), 80n);
});

test('history is capped so a circle cannot grow without bound', () => {
  const circle = newCircle({ n: 2 });
  for (let i = 0; i < 100; i++) {
    join(circle, { account: 'ada', slot: 1, deposit: 500n, now: T0 });
    leave(circle, { account: 'ada', now: T0 });
  }
  assert.equal(circle.history.length, LIMITS.HISTORY_CAP);
});
