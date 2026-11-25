/**
 * Pay from any chain: the pure parts (no network, no DOM), shared by the web app,
 * the /api proxies and the tests.
 *
 * Field names and enums follow the 1Click OpenAPI spec (v0.1.10, read Nov 25, 2026):
 *   https://1click.chaindefuser.com/docs/v0/openapi.yaml
 */

/** Origin routes offered in the drawer. Asset ids always come from the live /v0/tokens list. */
export const ROUTES = Object.freeze([
  { key: 'base:USDC', chain: 'base', symbol: 'USDC', label: 'USDC', where: 'on Base', family: 'evm' },
  { key: 'sol:SOL', chain: 'sol', symbol: 'SOL', label: 'SOL', where: 'on Solana', family: 'sol' },
  { key: 'sol:USDC', chain: 'sol', symbol: 'USDC', label: 'USDC', where: 'on Solana', family: 'sol' },
  { key: 'arb:USDC', chain: 'arb', symbol: 'USDC', label: 'USDC', where: 'on Arbitrum', family: 'evm' },
  { key: 'tron:USDT', chain: 'tron', symbol: 'USDT', label: 'USDT', where: 'on Tron', family: 'tron' },
  { key: 'eth:USDC', chain: 'eth', symbol: 'USDC', label: 'USDC', where: 'on Ethereum', family: 'evm' },
]);

/**
 * Route minimums 1Click enforced when measured with dry quotes on Nov 25, 2026. They are
 * not in the API spec and can change ("Temporary swap limits"), so the drawer also reads
 * the minimum from 1Click's error message. Base, Arbitrum and Solana USDC and SOL quoted
 * fine from $0.50 up.
 */
export const KNOWN_MINIMUM_USD = Object.freeze({ 'tron:USDT': 100 });

/** Seconds between automatic refreshes of the dry (preview) quote while the drawer is open. */
export const PREVIEW_REFRESH_S = 30;
/** A preview older than this is never shown as live. */
export const PREVIEW_STALE_S = 75;

// ------------------------------------------------------------------ amounts

export const YOCTO = 10n ** 24n;

/** "12.5" NEAR → yocto string, or null when it is not a positive amount with ≤ 6 decimals. */
export function nearToYocto(text) {
  const clean = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const yocto = BigInt(whole) * YOCTO + BigInt((frac + '000000').slice(0, 6)) * 10n ** 18n;
  return yocto > 0n ? yocto.toString() : null;
}

/**
 * The amounts a member can pay with one tap, in yoctoNEAR:
 *   round      one contribution
 *   collateral what is still missing from their slot (or the whole slot while choosing one)
 */
export function presetAmounts({ contribution, collateralGap }) {
  const list = [{ key: 'round', label: '1 round', yocto: BigInt(contribution) }];
  if (collateralGap !== undefined && collateralGap !== null && BigInt(collateralGap) > 0n) {
    list.push({ key: 'collateral', label: 'My collateral', yocto: BigInt(collateralGap) });
  }
  list.push({ key: 'custom', label: 'Custom', yocto: null });
  return list;
}

/** Dollar value of a yoctoNEAR amount at a token-list price, for display only. */
export function usdOfNear(yocto, price) {
  const p = Number(price);
  if (!(p > 0) || yocto === null || yocto === undefined) return null;
  return (Number(BigInt(yocto) / 10n ** 18n) / 1e6) * p;
}

/** The parameter-checked request body for an exact-output quote that delivers `yocto` wNEAR. */
export function exactOutputRequest({ originAsset, destinationAsset, yocto, recipient, refundTo, dry }) {
  return { dry: dry !== false, swapType: 'EXACT_OUTPUT', originAsset, destinationAsset, amount: String(yocto), recipient, refundTo };
}

/** The minimum in a 1Click error such as "Temporary swap limits: minimum swap amount is $100". */
export function minimumFromError(message) {
  const match = /minimum swap amount is \$?([\d,.]+)/i.exec(String(message ?? ''));
  return match ? Number(match[1].replace(',', '')) : null;
}

/**
 * Every number the payer should see before paying, from a 1Click quote response's `quote`.
 * For EXACT_OUTPUT, `amountIn` includes the slippage buffer and any excess is refunded.
 */
export function quoteBreakdown(quote, { originDecimals, destinationDecimals = 24 } = {}) {
  if (!quote) return null;
  const fmt = (units, decimals) => (units === undefined || units === null ? null : Number(BigInt(units)) / 10 ** decimals);
  const send = Number(quote.amountInFormatted);
  const minIn = originDecimals === undefined ? null : fmt(quote.minAmountIn, originDecimals);
  const usdIn = Number(quote.amountInUsd);
  const usdOut = Number(quote.amountOutUsd);
  return {
    send,
    sendUsd: usdIn,
    minimumAccepted: minIn,
    receive: Number(quote.amountOutFormatted),
    receiveUsd: usdOut,
    minimumReceived: fmt(quote.minAmountOut, destinationDecimals),
    costUsd: Number.isFinite(usdIn - usdOut) ? Math.max(0, usdIn - usdOut) : null,
    refundFee: quote.refundFee && originDecimals !== undefined ? fmt(quote.refundFee, originDecimals) : null,
    seconds: Number(quote.timeEstimate) || null,
    deadline: quote.deadline ?? null,
  };
}

/** Seconds until an ISO deadline (negative once passed), or null without one. */
export function secondsLeft(deadline, nowMs = Date.now()) {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  return Number.isFinite(t) ? Math.floor((t - nowMs) / 1000) : null;
}

// ------------------------------------------------------------------ addresses

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 → bytes, or null if a character is not base58. */
export function base58Decode(text) {
  if (!text) return null;
  const little = []; // the number, least significant byte first
  for (const ch of text) {
    const value = B58.indexOf(ch);
    if (value < 0) return null;
    let carry = value;
    for (let i = 0; i < little.length; i++) {
      carry += little[i] * 58;
      little[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { little.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0; // each leading '1' is a leading zero byte
  while (text[zeros] === '1') zeros++;
  return Uint8Array.from([...new Array(zeros).fill(0), ...little.reverse()]);
}

/** SHA-256 (sync, small inputs only): used for Tron's base58check checksum. */
export function sha256(data) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  H.forEach((x, i) => outView.setUint32(i * 4, x));
  return out;
}

/** Placeholder text for the refund field, by chain family. */
export const REFUND_PLACEHOLDER = Object.freeze({ evm: '0x… (42 characters)', tron: 'T… (34 characters)', sol: 'Solana address (32–44 characters)' });

/**
 * Check a refund address for the origin chain. Returns null when it looks right, or a
 * plain sentence saying what is wrong. Format checks only: they cannot prove you own it.
 */
export function refundAddressProblem(family, address) {
  const a = String(address ?? '').trim();
  if (!a) return 'Enter the address you are paying from, so a failed payment can come back to you.';
  if (family === 'evm') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return 'That is not an EVM address: it should start with 0x and have 40 letters or numbers after it.';
    return null;
  }
  if (family === 'tron') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'That is not a Tron address: it should start with T and be 34 characters long.';
    const bytes = base58Decode(a);
    if (!bytes || bytes.length !== 25 || bytes[0] !== 0x41) return 'That is not a valid Tron address.';
    const check = sha256(sha256(bytes.slice(0, 21))).slice(0, 4);
    if (check.some((b, i) => b !== bytes[21 + i])) return 'That Tron address has a typo (its checksum does not match).';
    return null;
  }
  if (family === 'sol') {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'That is not a Solana address: it should be 32 to 44 letters and numbers.';
    const bytes = base58Decode(a);
    if (!bytes || bytes.length !== 32) return 'That is not a valid Solana address.';
    return null;
  }
  return 'Unknown chain.';
}

/**
 * Check a NEAR mainnet account id (format only; the drawer also asks RPC whether it exists).
 * Returns null when it looks right, or a plain sentence.
 */
export function nearMainnetAccountProblem(id) {
  const a = String(id ?? '').trim();
  if (!a) return 'Enter your NEAR mainnet account, for example yourname.near.';
  if (a.endsWith('.testnet')) return 'That is a testnet account. 1Click pays out on mainnet: use an account ending in .near.';
  if (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a)) return null; // implicit accounts
  if (a.length < 2 || a.length > 64 || !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a)) return 'That is not a NEAR account name. It looks like yourname.near.';
  if (!a.includes('.')) return 'Add the ending: NEAR mainnet accounts look like yourname.near.';
  return null;
}
