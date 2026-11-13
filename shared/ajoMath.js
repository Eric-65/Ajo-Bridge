/**
 * Ajo Bridge — shared circle math.
 *
 * Pure functions, no I/O, BigInt everywhere. The same file is imported by the
 * near-sdk-js contract, the web app, the Alajo agent and the tests, so every
 * surface quotes exactly the same numbers.
 *
 * Vocabulary
 *   n            number of members (= number of rounds = number of payout slots)
 *   C            contribution each member pays every round (smallest unit, e.g. yoctoNEAR)
 *   k            payout slot, 1..n — the member in slot k receives the pot of round k
 *   R_k          what slot k still owes the group after being paid:  (n − k) × C
 *   S_k          collateral locked to take slot k:  max(C, R_k × coverageBps / 10000)
 *   F_k          fair-order fee charged on slot k's payout:  R_k × orderFeeBps / 10000
 *   fee share    the fee pool is split by waiting time: slot j has weight (j − 1)
 */

export const BPS = 10000n;

/** Coerce numbers / numeric strings / bigints to BigInt. */
export function big(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`not a safe integer: ${value}`);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`cannot convert to BigInt: ${String(value)}`);
}

const minBig = (a, b) => (a < b ? a : b);
const maxBig = (a, b) => (a > b ? a : b);

/**
 * Normalise and validate circle terms.
 * @param {{n: number, contribution: bigint|string|number, coverageBps?: number, orderFeeBps?: number}} terms
 * @returns {{n: number, contribution: bigint, coverageBps: number, orderFeeBps: number}}
 */
export function normalizeTerms(terms) {
  const n = Number(terms.n);
  const contribution = big(terms.contribution);
  const coverageBps = Number(terms.coverageBps ?? 10000);
  const orderFeeBps = Number(terms.orderFeeBps ?? 0);
  if (!Number.isInteger(n) || n < 2) throw new Error('n must be an integer >= 2');
  if (contribution <= 0n) throw new Error('contribution must be positive');
  if (!Number.isInteger(coverageBps) || coverageBps < 0 || coverageBps > 10000) {
    throw new Error('coverageBps must be an integer between 0 and 10000');
  }
  if (!Number.isInteger(orderFeeBps) || orderFeeBps < 0 || orderFeeBps > 10000) {
    throw new Error('orderFeeBps must be an integer between 0 and 10000');
  }
  return { n, contribution, coverageBps, orderFeeBps };
}

function checkSlot(n, k) {
  if (!Number.isInteger(k) || k < 1 || k > n) throw new Error(`slot must be an integer between 1 and ${n}`);
}

/** R_k — what the member in slot k still owes after receiving their payout. */
export function remainingOwed(terms, k) {
  const t = normalizeTerms(terms);
  checkSlot(t.n, k);
  return BigInt(t.n - k) * t.contribution;
}

/**
 * The part of R_k the circle wants covered by collateral once slot k has been paid:
 * R_k × coverageBps / 10000 (rounded down). Used for the payout top-up rule.
 */
export function coverageTarget(terms, k) {
  const t = normalizeTerms(terms);
  return (remainingOwed(t, k) * BigInt(t.coverageBps)) / BPS;
}

/** S_k — collateral required to take slot k: max(C, R_k × coverageBps / 10000). */
export function slotCollateral(terms, k) {
  const t = normalizeTerms(terms);
  return maxBig(t.contribution, coverageTarget(t, k));
}

/** F_k — fair-order fee deducted from slot k's payout: R_k × orderFeeBps / 10000. */
export function slotFee(terms, k) {
  const t = normalizeTerms(terms);
  return (remainingOwed(t, k) * BigInt(t.orderFeeBps)) / BPS;
}

/** Sum of all F_k when every round is paid in full. */
export function feePoolTotal(terms) {
  const t = normalizeTerms(terms);
  let total = 0n;
  for (let k = 1; k <= t.n; k++) total += slotFee(t, k);
  return total;
}

/** Waiting-time weights: slot j waited (j − 1) rounds for its payout. */
export function feeWeights(n) {
  return Array.from({ length: n }, (_, i) => BigInt(i));
}

/**
 * Split `pool` proportionally to `weights` (rounding down). Rounding dust goes to
 * the heaviest weight (the last one on ties) so the shares always sum to `pool`.
 * If every weight is zero the pool is split equally.
 * @param {bigint} pool
 * @param {bigint[]} weights
 * @returns {bigint[]}
 */
export function splitByWeights(pool, weights) {
  const amount = big(pool);
  if (amount < 0n) throw new Error('pool must not be negative');
  if (weights.length === 0) {
    if (amount > 0n) throw new Error('cannot split a pool among nobody');
    return [];
  }
  let w = weights.map(big);
  if (w.some((x) => x < 0n)) throw new Error('weights must not be negative');
  let total = w.reduce((a, b) => a + b, 0n);
  if (total === 0n) {
    w = w.map(() => 1n);
    total = BigInt(w.length);
  }
  const shares = w.map((x) => (amount * x) / total);
  const dust = amount - shares.reduce((a, b) => a + b, 0n);
  let heaviest = 0;
  for (let i = 0; i < w.length; i++) if (w[i] >= w[heaviest]) heaviest = i;
  shares[heaviest] += dust;
  return shares;
}

/** Fee share of every slot (index 0 = slot 1) when nobody defaults. */
export function feeShares(terms) {
  const t = normalizeTerms(terms);
  return splitByWeights(feePoolTotal(t), feeWeights(t.n));
}

/**
 * Everything a member needs to know before picking slot k.
 * `honestNet` is what an on-time member ends the circle with, relative to zero:
 * late slots are positive (they earned the order fee), early slots negative (they paid it).
 */
export function slotQuote(terms, k) {
  const t = normalizeTerms(terms);
  const fee = slotFee(t, k);
  const feeShare = feeShares(t)[k - 1];
  const pot = BigInt(t.n) * t.contribution;
  return {
    slot: k,
    owedAfterPayout: remainingOwed(t, k),
    collateral: slotCollateral(t, k),
    fee,
    feeShare,
    pot,
    payout: pot - fee,
    honestNet: feeShare - fee,
  };
}

/** slotQuote for every slot, in slot order. */
export function slotTable(terms) {
  const t = normalizeTerms(terms);
  return Array.from({ length: t.n }, (_, i) => slotQuote(t, i + 1));
}

/**
 * Closed-form payoff of the classic ROSCA attack: the member in slot k pays
 * rounds 1..k, collects the pot, then never pays again. Everyone else is honest
 * and the walker has no vouchers.
 *
 *   paid      = k × C
 *   received  = n × C − F_k
 *   slashed   = min(S_k, R_k)            collateral taken round by round
 *   shortfall = R_k − slashed            what the group is left short
 *   net       = received − paid − slashed
 *
 * A member who misses any payment also forfeits their fee share, so nothing is
 * added back. With coverageBps = 10000 this gives net = −F_k ≤ 0 and shortfall = 0.
 */
export function walkAwayPayoff(terms, k) {
  const t = normalizeTerms(terms);
  const owed = remainingOwed(t, k);
  const collateral = slotCollateral(t, k);
  const fee = slotFee(t, k);
  const paid = BigInt(k) * t.contribution;
  const received = BigInt(t.n) * t.contribution - fee;
  const slashed = minBig(collateral, owed);
  const defaulted = owed > 0n;
  const feeShare = defaulted ? 0n : feeShares(t)[k - 1];
  return {
    slot: k,
    paid,
    received,
    collateral,
    slashed,
    collateralReturned: collateral - slashed,
    shortfall: owed - slashed,
    feeShare,
    net: received - paid - slashed + feeShare,
  };
}
