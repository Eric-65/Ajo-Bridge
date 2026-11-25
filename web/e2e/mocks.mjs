/**
 * Mocks for the pay drawer: /api/tokens, /api/quote, /api/status and NEAR mainnet RPC.
 * Shapes follow the 1Click OpenAPI spec (v0.1.10); numbers are modelled on dry quotes
 * recorded on Nov 25, 2026 (0.5 NEAR from Base USDC cost 1.512889 USDC).
 */
export const TOKENS = [
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 0.9996 },
  { assetId: 'nep141:sol.omft.near', decimals: 9, blockchain: 'sol', symbol: 'SOL', price: 70.47 },
  { assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', decimals: 6, blockchain: 'tron', symbol: 'USDT', price: 0.9991 },
  { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR', price: 3.01 },
];

const NEAR_PRICE = 3.01;

/** A quote for `yocto` NEAR out, priced like the recorded Base USDC quote. */
export function fakeQuote(request, extra = {}) {
  const nearOut = Number(BigInt(request.amount) / 10n ** 18n) / 1e6;
  const token = TOKENS.find((t) => t.assetId === request.originAsset);
  const usd = nearOut * NEAR_PRICE * 1.0048;
  const inTokens = (usd * 1.01) / token.price;
  const units = (x) => BigInt(Math.round(x * 10 ** Math.min(token.decimals, 9))) * 10n ** BigInt(token.decimals - Math.min(token.decimals, 9));
  return {
    amountIn: units(inTokens).toString(),
    amountInFormatted: inTokens.toFixed(6),
    amountInUsd: (usd * 1.01).toFixed(4),
    minAmountIn: units(inTokens / 1.01).toString(),
    amountOut: request.amount,
    amountOutFormatted: String(nearOut),
    amountOutUsd: (nearOut * NEAR_PRICE).toFixed(4),
    minAmountOut: request.amount,
    timeEstimate: 37,
    refundFee: token.decimals === 6 ? '2400' : '50000',
    withdrawFee: '0',
    ...extra,
  };
}

/**
 * Install the mocks on a page. Returns the list of /api/quote request bodies seen.
 * status: the sequence of statuses /api/status returns, one per poll (the last repeats).
 */
export async function mockPayApis(page, { status = ['PENDING_DEPOSIT'], accountExists = true } = {}) {
  const quotes = [];
  await page.route('**/api/tokens', (route) => route.fulfill({ json: TOKENS }));
  await page.route('**/api/quote', async (route) => {
    const body = route.request().postDataJSON();
    quotes.push(body);
    if (body.originAsset.includes('tron-')) {
      return route.fulfill({ status: 400, json: { error: 'Temporary swap limits: minimum swap amount is $100', upstreamStatus: 400 } });
    }
    const extra = body.dry === false
      ? { depositAddress: '0x1111111111111111111111111111111111111111', deadline: new Date(Date.now() + 10 * 60_000).toISOString(), timeWhenInactive: new Date(Date.now() + 10 * 60_000).toISOString() }
      : {};
    return route.fulfill({ json: { correlationId: 'test', timestamp: new Date().toISOString(), signature: 'sig', quoteRequest: body, quote: fakeQuote(body, extra) } });
  });
  let poll = 0;
  await page.route('**/api/status**', (route) => {
    const s = status[Math.min(poll++, status.length - 1)];
    return route.fulfill({ json: { correlationId: 'test', status: s, updatedAt: new Date().toISOString(), swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [] } } });
  });
  await page.route('https://rpc.mainnet.fastnear.com/**', (route) => route.fulfill({
    json: accountExists
      ? { jsonrpc: '2.0', id: 'ajo', result: { amount: '1', locked: '0', code_hash: '11111111111111111111111111111111', storage_usage: 100, block_height: 1 } }
      : { jsonrpc: '2.0', id: 'ajo', error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT' }, message: 'account does not exist' } },
  }));
  await page.route('https://rpc.mainnet.fastnear.com', (route) => route.fallback());
  return quotes;
}

/** Open the app in demo mode (the circles run in the browser, no testnet needed). */
export async function demoMode(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('ajo-mode', 'demo'); } catch { /* ignore */ } });
  // Live RPC is never needed in demo mode; fail it fast so the app does not wait on it.
  await page.route(/rpc\.testnet\.near\.org|test\.rpc\.fastnear\.com/, (route) => route.abort());
}
