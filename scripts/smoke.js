#!/usr/bin/env node
/**
 * npm run smoke — live checks to run on YOUR machine after deploying.
 * Every check talks to a real service; nothing here is mocked.
 *
 *   1. NEAR Intents 1Click (mainnet): token list + a DRY quote (commits nothing)
 *   2. NEAR testnet RPC: the contract's get_config and list_circles views
 *   3. NEAR AI Cloud: a one-line completion (only if NEAR_AI_API_KEY is set)
 *   4. A deployed site (only if SMOKE_URL is set): /api/tokens and /api/alajo
 *
 * Reads .env from the repository root. Exits non-zero if any check fails.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildQuoteRequest } from '../api/quote.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* use the real environment */ }

const ONECLICK = process.env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com';
const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const CONTRACT = process.env.AJO_CONTRACT_ID || process.env.VITE_AJO_CONTRACT_ID;
const NEAR_AI = process.env.NEAR_AI_BASE_URL || 'https://cloud-api.near.ai/v1';
const SITE = process.env.SMOKE_URL?.replace(/\/$/, '');

let failures = 0;
const ok = (label, detail = '') => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, error) => { failures += 1; console.log(`  ✗ ${label} — ${error?.message ?? error}`); };
const skip = (label, why) => console.log(`  · ${label} — skipped: ${why}`);

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function view(method, args = {}) {
  const body = await json(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'smoke', method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') },
    }),
  });
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
  if (body.result?.error) throw new Error(body.result.error);
  return JSON.parse(Buffer.from(body.result.result).toString('utf8'));
}

console.log('\n1. NEAR Intents 1Click (mainnet)');
let tokens = [];
try {
  tokens = await json(`${ONECLICK}/v0/tokens`);
  ok('GET /v0/tokens', `${tokens.length} tokens`);
} catch (error) { bad('GET /v0/tokens', error); }
const usdcBase = tokens.find((t) => t.blockchain === 'base' && t.symbol === 'USDC');
const wnear = tokens.find((t) => t.blockchain === 'near' && t.symbol === 'wNEAR');
if (usdcBase && wnear) {
  try {
    const request = buildQuoteRequest({
      dry: true, originAsset: usdcBase.assetId, destinationAsset: wnear.assetId, amount: '20000000',
      recipient: 'near', refundTo: '0x000000000000000000000000000000000000dEaD',
    });
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ONECLICK_JWT) headers.Authorization = `Bearer ${process.env.ONECLICK_JWT}`;
    const quote = await json(`${ONECLICK}/v0/quote`, { method: 'POST', headers, body: JSON.stringify(request) });
    ok('POST /v0/quote (dry)', `20 USDC on Base → ${quote.quote?.amountOutFormatted} wNEAR, ~${quote.quote?.timeEstimate}s`);
  } catch (error) { bad('POST /v0/quote (dry)', error); }
} else if (tokens.length) {
  bad('find USDC on Base and wNEAR in the token list', 'not found: PayDrawer routes may need new symbols');
}

console.log('\n2. NEAR testnet contract');
if (!CONTRACT) {
  skip('contract views', 'set AJO_CONTRACT_ID in .env after running contract/scripts/deploy.sh');
} else {
  try {
    const config = await view('get_config');
    ok('get_config', `owner ${config.owner}, agent ${config.agent}, ${config.circles} circles`);
    const circles = await view('list_circles', { limit: 5 });
    ok('list_circles', circles.map((c) => `#${c.id} ${c.name} (${c.status})`).join(', ') || 'none yet');
    if (process.env.ALAJO_ACCOUNT_ID && config.agent !== process.env.ALAJO_ACCOUNT_ID) {
      bad('agent account', `contract agent is ${config.agent}, .env says ${process.env.ALAJO_ACCOUNT_ID}`);
    }
  } catch (error) { bad(`views on ${CONTRACT}`, error); }
}

console.log('\n3. NEAR AI Cloud');
if (!process.env.NEAR_AI_API_KEY) {
  skip('chat completion', 'NEAR_AI_API_KEY not set (Alajo will use its built-in templates)');
} else {
  try {
    const model = process.env.NEAR_AI_MODEL || 'deepseek-ai/DeepSeek-V3.1';
    const data = await json(`${NEAR_AI}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}` },
      body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
    });
    ok(`chat completion (${model})`, JSON.stringify(data.choices?.[0]?.message?.content ?? '').slice(0, 60));
  } catch (error) { bad('chat completion', error); }
}

console.log('\n4. Deployed site');
if (!SITE) {
  skip('site API routes', 'set SMOKE_URL=https://your-app.vercel.app');
} else {
  try {
    const list = await json(`${SITE}/api/tokens`);
    ok('GET /api/tokens', `${list.length} tokens through the proxy`);
  } catch (error) { bad('GET /api/tokens', error); }
  try {
    const circle = { id: 0, name: 'Smoke', creator: 'a', n: 2, contribution: '1', coverage_bps: 10000, order_fee_bps: 0, round_ns: '60000000000', status: 'OPEN', round: 0, deadline_ns: '0', created_ns: '0', started_ns: '0', slots: [null, null], members: {}, pot: '0', fee_pool: '0', escrow: '0', shortfall: '0', rounds: [], history: [], notes: [] };
    const answer = await json(`${SITE}/api/alajo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ circle, question: 'Who has not paid?' }) });
    ok('POST /api/alajo', `${answer.source}: ${String(answer.answer).slice(0, 70)}`);
  } catch (error) { bad('POST /api/alajo', error); }
}

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll live checks passed.\n');
process.exitCode = failures ? 1 : 0;
