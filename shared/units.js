/**
 * Amount helpers. NEAR amounts are integers of yoctoNEAR (1 NEAR = 10^24 yocto).
 * Everything stays in BigInt; decimals only exist at the edges (forms and labels).
 */

export const NEAR_DECIMALS = 24;
export const ONE_NEAR = 10n ** 24n;

/** "1.5" -> 1500000000000000000000000n (for `decimals` = 24). */
export function parseUnits(text, decimals = NEAR_DECIMALS) {
  const clean = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error(`not a decimal amount: "${text}"`);
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/**
 * 1500000000000000000000000n -> "1.50". Rounds half up to `precision` places and
 * keeps the sign, so nets such as -0.80 print correctly.
 */
export function formatUnits(amount, decimals = NEAR_DECIMALS, precision = 2) {
  const value = BigInt(amount);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals - precision);
  const rounded = (abs + scale / 2n) / scale;
  const base = 10n ** BigInt(precision);
  const whole = rounded / base;
  const fraction = (rounded % base).toString().padStart(precision, '0');
  const sign = negative && rounded !== 0n ? '-' : '';
  return precision > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export const parseNear = (text) => parseUnits(text, NEAR_DECIMALS);
export const formatNear = (yocto, precision = 2) => formatUnits(yocto, NEAR_DECIMALS, precision);
