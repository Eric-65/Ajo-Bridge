#!/usr/bin/env node
/**
 * npm run seed:testnet — put real circles on the live testnet contract, signing
 * every call the web app makes: create_circle, join, vouch, leave, contribute
 * and settle_round. It prints each transaction hash with an explorer link.
 *
 * Accounts come from the environment only (never commit keys):
 *
 *   SEED_ACCOUNTS="you1.testnet:ed25519:PRIVATE_KEY,you2.testnet:ed25519:PRIVATE_KEY,you3.testnet:ed25519:PRIVATE_KEY"
 *
 * Each account needs about 4 testnet NEAR. Optional: AJO_CONTRACT_ID (defaults to
 * ajobridge-circles.testnet), NEAR_RPC_URL.
 *
 * What it leaves on chain:
 *   1. "Lagos to London Family"  OPEN, 4 slots, 3 open. Slot 1 reserved with 10% and
 *      backed by a voucher. A member joins slot 4 and leaves again (join + leave).
 *   2. "Balogun Market Traders"  ACTIVE, 7-day rounds, round 1 with 2 of 3 paid.
 *   3. "Quick Settle Demo"       ACTIVE, 60-second rounds. Round 1 is settled with a
 *      slash; round 2 is left for you to settle from the app after its deadline.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* use the real environment */ }

// near-api-js is installed for the agent (npm run setup); fall back to that copy.
let near;
try { near = await import('near-api-js'); } catch {
  near = await import(pathToFileURL(path.join(root, 'agent/node_modules/near-api-js/lib/index.js')).href);
}
const { Account, JsonRpcProvider, actions } = near;

const CONTRACT = process.env.AJO_CONTRACT_ID || 'ajobridge-circles.testnet';
const RPC = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
const GAS = 100_000_000_000_000n;
const n = (x) => BigInt(Math.round(x * 1000)) * 10n ** 21n; // decimal NEAR → yocto
const fmt = (yocto) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3);

const raw = (process.env.SEED_ACCOUNTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (raw.length < 3) {
  console.error('Set SEED_ACCOUNTS to three testnet accounts: "id:ed25519:key,id:ed25519:key,id:ed25519:key"');
  process.exit(1);
}
const provider = new JsonRpcProvider({ url: RPC });
const [a, b, c] = raw.slice(0, 3).map((entry) => {
  const i = entry.indexOf(':');
  return new Account(entry.slice(0, i), provider, entry.slice(i + 1));
});

const view = (method, args = {}) => provider.callFunction({ contractId: CONTRACT, method, args });
const log = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(account, methodName, args, deposit = 0n, label = methodName) {
  const outcome = await account.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall(methodName, args, GAS, deposit)],
  });
  const failure = outcome?.status?.Failure;
  const hash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
  if (failure) throw new Error(`${label} failed (${hash}): ${JSON.stringify(failure).slice(0, 300)}`);
  let value = null;
  if (outcome?.status?.SuccessValue) {
    try { value = JSON.parse(Buffer.from(outcome.status.SuccessValue, 'base64').toString()); } catch { /* no value */ }
  }
  log.push({ label, method: methodName, account: account.accountId, hash });
  console.log(`  ✓ ${label.padEnd(44)} ${hash}`);
  return value;
}

async function createCircle(account, terms) {
  const fee = BigInt(await view('storage_fee', { members: terms.members }));
  return call(account, 'create_circle', terms, fee, `create_circle "${terms.name}"`);
}
const quote = async (id, slot) => BigInt((await view('quote_slot', { circle_id: id, slot })).collateral);

console.log(`Seeding ${CONTRACT} on NEAR testnet\n`);
for (const acc of [a, b, c]) {
  const balance = await acc.getBalance().catch(() => null);
  console.log(`  ${acc.accountId}${balance !== null ? `  ${fmt(balance)} NEAR` : ''}`);
}
console.log('');

// 1. Open circle with a voucher, and a join followed by a leave.
console.log('1. Lagos to London Family (open)');
const open = await createCircle(a, { name: 'Lagos to London Family', members: 4, contribution: n(0.5).toString(), round_secs: 30 * 86400, coverage_bps: 10000, order_fee_bps: 50 });
const s1 = await quote(open, 1);
const reserve = (s1 + 9n) / 10n;
await call(a, 'join', { circle_id: open, slot: 1 }, reserve, `join slot 1 with a 10% reserve`);
await call(c, 'vouch', { circle_id: open, member: a.accountId }, s1 - reserve, `vouch the rest of slot 1`);
await call(b, 'join', { circle_id: open, slot: 4 }, await quote(open, 4), `join slot 4`);
await call(b, 'leave', { circle_id: open }, 0n, `leave (full refund)`);

// 2. Active circle, mid-round, long rounds.
console.log('\n2. Balogun Market Traders (active, 7-day rounds)');
const market = await createCircle(a, { name: 'Balogun Market Traders', members: 3, contribution: n(0.5).toString(), round_secs: 7 * 86400, coverage_bps: 10000, order_fee_bps: 100 });
await call(a, 'join', { circle_id: market, slot: 1 }, await quote(market, 1), 'join slot 1');
await call(b, 'join', { circle_id: market, slot: 2 }, await quote(market, 2), 'join slot 2');
await call(c, 'join', { circle_id: market, slot: 3 }, await quote(market, 3), 'join slot 3 (circle starts)');
await call(a, 'contribute', { circle_id: market }, n(0.5), 'contribute round 1');
await call(b, 'contribute', { circle_id: market }, n(0.5), 'contribute round 1');

// 3. Short rounds: a real settle_round with a slash, then a round left to settle in the app.
console.log('\n3. Quick Settle Demo (active, 60-second rounds)');
const quick = await createCircle(a, { name: 'Quick Settle Demo', members: 2, contribution: n(0.5).toString(), round_secs: 60, coverage_bps: 10000, order_fee_bps: 100 });
await call(a, 'join', { circle_id: quick, slot: 1 }, await quote(quick, 1), 'join slot 1');
await call(b, 'join', { circle_id: quick, slot: 2 }, await quote(quick, 2), 'join slot 2 (circle starts)');
await call(a, 'contribute', { circle_id: quick }, n(0.5), 'contribute round 1 (b does not)');
let circle = await view('get_circle', { circle_id: quick });
const wait = Math.max(0, Number((BigInt(circle.deadline_ns) - BigInt(circle.now_ns)) / 1_000_000n)) + 8000;
console.log(`  … waiting ${Math.round(wait / 1000)} s for the round deadline`);
await sleep(wait);
await call(c, 'settle_round', { circle_id: quick }, 0n, 'settle_round (anyone can; b is slashed)');
circle = await view('get_circle', { circle_id: quick });

console.log('\nOn chain now:');
for (const id of [open, market, quick]) {
  const x = await view('get_circle', { circle_id: id });
  console.log(`  #${id} ${x.name.padEnd(24)} ${x.status.padEnd(7)} round ${x.round} · ${x.slots.filter(Boolean).length}/${x.n} slots · escrow ${fmt(x.escrow)} NEAR`);
}
const slashed = circle.members[b.accountId]?.slashed ?? '0';
console.log(`  Quick Settle Demo: ${b.accountId} slashed ${fmt(slashed)} NEAR`);

console.log('\nTransactions (testnet explorer):');
for (const t of log) console.log(`  ${t.method.padEnd(13)} https://testnet.nearblocks.io/txns/${t.hash}`);
console.log(`\nSEED_RESULT ${JSON.stringify({ contract: CONTRACT, circles: { open, market, quick }, transactions: log })}`);
