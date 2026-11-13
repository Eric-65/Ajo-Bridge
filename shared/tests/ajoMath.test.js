import test from 'node:test';
import assert from 'node:assert/strict';

import {
  big, coverageTarget, feePoolTotal, feeShares, feeWeights, normalizeTerms, remainingOwed, slotCollateral,
  slotFee, slotQuote, slotTable, splitByWeights, walkAwayPayoff,
} from '../ajoMath.js';
import { formatUnits, parseNear, parseUnits, formatNear } from '../units.js';

// The README's worked example: 5 members, 20 per round. Amounts use 2 decimals (2000 = 20.00).
const C = 2000n;
const strangers = { n: 5, contribution: C, coverageBps: 10000, orderFeeBps: 100 };
const friends = { ...strangers, coverageBps: 5000 };
const slots = [1, 2, 3, 4, 5];

test('R_k = (n - k) x C', () => {
  assert.deepEqual(slots.map((k) => remainingOwed(strangers, k)), [8000n, 6000n, 4000n, 2000n, 0n]);
});

test('S_k with full coverage: early slots lock more, the last slot locks only C', () => {
  assert.deepEqual(slots.map((k) => slotCollateral(strangers, k)), [8000n, 6000n, 4000n, 2000n, 2000n]);
});

test('S_k with 50% coverage is floored at C', () => {
  assert.deepEqual(slots.map((k) => slotCollateral(friends, k)), [4000n, 3000n, 2000n, 2000n, 2000n]);
  assert.deepEqual(slots.map((k) => coverageTarget(friends, k)), [4000n, 3000n, 2000n, 1000n, 0n]);
});

test('S_k with zero coverage is always C', () => {
  const none = { ...strangers, coverageBps: 0 };
  assert.deepEqual(slots.map((k) => slotCollateral(none, k)), [C, C, C, C, C]);
});

test('F_k = R_k x orderFeeBps / 10000', () => {
  assert.deepEqual(slots.map((k) => slotFee(strangers, k)), [80n, 60n, 40n, 20n, 0n]);
  assert.equal(feePoolTotal(strangers), 200n);
});

test('fee pool is shared by waiting time (weight j - 1)', () => {
  assert.deepEqual(feeWeights(5), [0n, 1n, 2n, 3n, 4n]);
  assert.deepEqual(feeShares(strangers), [0n, 20n, 40n, 60n, 80n]);
});

test('honest nets sum to zero: the order fee only moves money from early slots to late slots', () => {
  const table = slotTable(strangers);
  assert.deepEqual(table.map((q) => q.honestNet), [-80n, -40n, 0n, 40n, 80n]);
  assert.equal(table.reduce((sum, q) => sum + q.honestNet, 0n), 0n);
  assert.equal(slotQuote(strangers, 1).payout, 10000n - 80n);
});

test('splitByWeights conserves the pool and gives rounding dust to the heaviest weight', () => {
  assert.deepEqual(splitByWeights(100n, [0n, 1n, 2n]), [0n, 33n, 67n]);
  assert.deepEqual(splitByWeights(10n, [0n, 0n, 0n]), [3n, 3n, 4n]);
  assert.deepEqual(splitByWeights(0n, [1n, 2n]), [0n, 0n]);
  assert.deepEqual(splitByWeights(0n, []), []);
  assert.throws(() => splitByWeights(1n, []), /nobody/);
  for (let pool = 0n; pool < 200n; pool += 7n) {
    for (let n = 2; n <= 12; n++) {
      const shares = splitByWeights(pool, feeWeights(n));
      assert.equal(shares.reduce((a, b) => a + b, 0n), pool);
      assert.ok(shares.every((s) => s >= 0n));
    }
  }
});

test('walk-away payoff, worked example: slot 1 with full coverage loses exactly the order fee', () => {
  const p = walkAwayPayoff(strangers, 1);
  assert.equal(p.paid, 2000n);
  assert.equal(p.received, 9920n);
  assert.equal(p.slashed, 8000n);
  assert.equal(p.shortfall, 0n);
  assert.equal(p.net, -80n);
});

test('walk-away payoff with 50% coverage shows why coverage matters', () => {
  const p = walkAwayPayoff(friends, 1);
  assert.equal(p.slashed, 4000n);
  assert.equal(p.shortfall, 4000n);
  assert.equal(p.net, 3920n);
});

test('INVARIANT (closed form): with coverageBps = 10000 walking away never pays, for any n, slot and fee', () => {
  for (let n = 2; n <= 12; n++) {
    for (const orderFeeBps of [0, 1, 100, 250, 2000]) {
      for (const contribution of [1n, 3n, 2000n, 10n ** 24n]) {
        const terms = { n, contribution, coverageBps: 10000, orderFeeBps };
        for (let k = 1; k <= n; k++) {
          const p = walkAwayPayoff(terms, k);
          assert.equal(p.shortfall, 0n, `n=${n} k=${k}: group must be fully covered`);
          if (k < n) {
            assert.equal(p.net, -slotFee(terms, k), `n=${n} k=${k}: walker loses the order fee`);
            assert.ok(p.net <= 0n);
          } else {
            // The last slot owes nothing after its payout: "walking away" is just finishing.
            assert.equal(p.net, feeShares(terms)[n - 1]);
          }
        }
      }
    }
  }
});

test('terms are validated', () => {
  assert.throws(() => normalizeTerms({ n: 1, contribution: 1n }), /n must be/);
  assert.throws(() => normalizeTerms({ n: 3, contribution: 0n }), /contribution/);
  assert.throws(() => normalizeTerms({ n: 3, contribution: 1n, coverageBps: 10001 }), /coverageBps/);
  assert.throws(() => normalizeTerms({ n: 3, contribution: 1n, orderFeeBps: -1 }), /orderFeeBps/);
  assert.throws(() => slotCollateral(strangers, 0), /slot/);
  assert.throws(() => slotCollateral(strangers, 6), /slot/);
  assert.throws(() => big('1.5'), /cannot convert/);
  assert.throws(() => big(1.5), /safe integer/);
  assert.equal(big('42'), 42n);
});

test('unit helpers round-trip NEAR amounts', () => {
  assert.equal(parseNear('1.5'), 1500000000000000000000000n);
  assert.equal(formatNear(parseNear('20')), '20.00');
  assert.equal(formatNear(-parseNear('0.8')), '-0.80');
  assert.equal(formatUnits(1999n, 3, 2), '2.00');
  assert.equal(formatUnits(-4n, 3, 2), '0.00');
  assert.equal(parseUnits('0.000001', 6), 1n);
  assert.throws(() => parseUnits('1.2345678', 6), /decimal places/);
  assert.throws(() => parseUnits('abc'), /not a decimal/);
});
