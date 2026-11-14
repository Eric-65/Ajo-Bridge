/** GET /api/status?depositAddress=… — proxy for 1Click GET /v0/status (mainnet). */
import { fail, oneClick, relay } from './_oneclick.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const depositAddress = String(req.query?.depositAddress ?? '');
  if (!/^[a-zA-Z0-9._:-]{10,128}$/.test(depositAddress)) return res.status(400).json({ error: 'depositAddress is required' });
  const memo = req.query?.depositMemo ? `&depositMemo=${encodeURIComponent(String(req.query.depositMemo))}` : '';
  try {
    res.setHeader('Cache-Control', 'no-store');
    return relay(res, await oneClick(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}${memo}`));
  } catch (error) {
    return fail(res, error);
  }
}
