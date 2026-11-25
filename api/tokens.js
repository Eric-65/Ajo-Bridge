/** GET /api/tokens — tokens 1Click can swap (mainnet). Cached at the edge for five minutes. */
import { fail, oneClick, relay } from './_oneclick.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const upstream = await oneClick('/v0/tokens', { retry: true });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return relay(res, upstream);
  } catch (error) {
    return fail(res, error);
  }
}
