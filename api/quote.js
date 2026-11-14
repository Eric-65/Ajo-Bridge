/**
 * POST /api/quote — proxy for 1Click POST /v0/quote (mainnet).
 *
 *   dry: true   price preview, nothing is committed
 *   dry: false  commits the quote and returns a deposit address (valid ~10 minutes)
 *
 * Only the fields below are forwarded, so the browser cannot set fee recipients
 * or routing options through this endpoint.
 */
import { fail, oneClick, relay } from './_oneclick.js';

const ASSET = /^[a-zA-Z0-9:._-]{3,200}$/;
const ADDRESS = /^[a-zA-Z0-9._:-]{2,128}$/;

export function buildQuoteRequest(body = {}) {
  const { originAsset, destinationAsset, amount, recipient, refundTo } = body;
  const dry = body.dry !== false;
  const swapType = body.swapType === 'EXACT_OUTPUT' ? 'EXACT_OUTPUT' : 'EXACT_INPUT';
  if (!ASSET.test(originAsset ?? '') || !ASSET.test(destinationAsset ?? '')) throw new Error('originAsset and destinationAsset must be assetIds from /api/tokens');
  if (!/^[1-9]\d{0,40}$/.test(String(amount ?? ''))) throw new Error('amount must be a positive integer in the token\'s smallest unit');
  if (!ADDRESS.test(recipient ?? '')) throw new Error('recipient must be a NEAR account id');
  if (!ADDRESS.test(refundTo ?? '')) throw new Error('refundTo must be an address on the origin chain');
  return {
    dry,
    swapType,
    slippageTolerance: 100, // 1%
    originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset,
    amount: String(amount),
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    referral: 'ajo-bridge',
    quoteWaitingTimeMs: 3000,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let request;
  try {
    request = buildQuoteRequest(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    return relay(res, await oneClick('/v0/quote', { method: 'POST', body: request }));
  } catch (error) {
    return fail(res, error);
  }
}
