/**
 * NEAR Intents 1Click API client (server side only).
 * Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api
 * OpenAPI: https://1click.chaindefuser.com/docs/v0/openapi.yaml
 *
 * 1Click runs on MAINNET (there is no 1Click testnet). The optional JWT (ONECLICK_JWT) removes the 0.2%
 * unauthenticated fee and must never reach the browser, which is why the web
 * app calls these proxies instead of 1Click directly.
 */

export const ONECLICK_BASE = process.env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com';

export async function oneClick(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (process.env.ONECLICK_JWT) headers.Authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${ONECLICK_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Send an upstream failure to the client without pretending it is our own data. */
export function relay(res, upstream) {
  if (upstream.status >= 200 && upstream.status < 300) return res.status(200).json(upstream.data);
  return res.status(upstream.status === 400 ? 400 : 502).json({
    error: upstream.data?.message ?? 'The 1Click API rejected the request',
    upstreamStatus: upstream.status,
  });
}

export function fail(res, error) {
  const timedOut = error?.name === 'AbortError';
  return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'The 1Click API did not answer in time' : `Could not reach the 1Click API: ${error?.message ?? error}` });
}
