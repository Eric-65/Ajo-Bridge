#!/usr/bin/env node
/**
 * Alajo — the Ajo Bridge coordinator agent.
 *
 * In a traditional ajo the alajo is the person who collects the money. Here
 * the contract holds the money, and Alajo is reduced to what a coordinator
 * should be: someone who reminds, reports and keeps rounds moving.
 *
 *   node agent/alajo.js status <circle_id> [--lang en|pcm|yo]
 *   node agent/alajo.js ask <circle_id> "Who hasn't paid?" [--account x.testnet] [--lang pcm]
 *   node agent/alajo.js tick [--lang pcm] [--dry-run]     one pass over every circle
 *   node agent/alajo.js watch [--interval 60] [--lang yo] keep ticking
 *
 * What a tick does, per circle:
 *   - round deadline passed            → settle_round, then post_note with the round report
 *   - all rounds paid                  → finalize (refunds collateral, shares fees)
 *   - round open, members still to pay → post_note with a reminder (once per round)
 *
 * What it can NOT do: the agent signs with a function-call access key limited
 * to settle_round, post_note and finalize on the Ajo Bridge contract (see
 * agent/setup-key.sh). NEAR rejects any other method, any attached deposit and
 * any transfer signed with that key, so a leaked key cannot move circle funds.
 *
 * Wording comes from NEAR AI Cloud (OpenAI-compatible API) when NEAR_AI_API_KEY
 * is set; otherwise from the deterministic templates in shared/alajo.js. Either
 * way every number is computed from contract state first, never by the model.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Account, JsonRpcProvider } from 'near-api-js';

import { STATUS, deserializeCircle } from '../shared/ajoEngine.js';
import {
  LANGUAGES, answerFromFacts, circleFacts, classifyQuestion, factsForPrompt, reminderNote, roundReport, systemPrompt,
} from '../shared/alajo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* no .env file: use the real environment */ }

const RPC_URL = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const CONTRACT_ID = process.env.AJO_CONTRACT_ID;
const AGENT_ID = process.env.ALAJO_ACCOUNT_ID;
const AGENT_KEY = process.env.ALAJO_PRIVATE_KEY;
const NEAR_AI_BASE = process.env.NEAR_AI_BASE_URL || 'https://cloud-api.near.ai/v1';
const NEAR_AI_MODEL = process.env.NEAR_AI_MODEL || 'deepseek-ai/DeepSeek-V3.1';
const GAS = 100_000_000_000_000n; // 100 Tgas
const NOTE_LIMIT = 280;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1] ?? true;
};
const lang = Object.hasOwn(LANGUAGES, flag('lang', 'en')) ? flag('lang', 'en') : 'en';
const dryRun = args.includes('--dry-run');
const now = () => BigInt(Date.now()) * 1_000_000n;
const log = (...parts) => console.log(new Date().toISOString(), ...parts);

function requireEnv(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const provider = new JsonRpcProvider({ url: RPC_URL });
const view = (method, methodArgs = {}) => provider.callFunction({ contractId: CONTRACT_ID, method, args: methodArgs });

async function getCircle(id) {
  return deserializeCircle(JSON.stringify(await view('get_circle', { circle_id: Number(id) })));
}

/** Change call signed with the agent's function-call key. Always zero deposit. */
async function call(methodName, methodArgs) {
  if (dryRun) { log(`[dry-run] would call ${methodName}`, JSON.stringify(methodArgs)); return null; }
  requireEnv('ALAJO_ACCOUNT_ID', 'ALAJO_PRIVATE_KEY');
  const account = new Account(AGENT_ID, provider, AGENT_KEY);
  return account.callFunction({ contractId: CONTRACT_ID, methodName, args: methodArgs, gas: GAS, deposit: 0n });
}

/** Ask NEAR AI Cloud to phrase facts. Returns null (never throws) so callers can fall back to templates. */
async function phrase(facts, instruction) {
  if (!process.env.NEAR_AI_API_KEY) return null;
  try {
    const response = await fetch(`${NEAR_AI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}` },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: NEAR_AI_MODEL,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt(lang) },
          { role: 'user', content: `Circle facts (JSON):\n${JSON.stringify(factsForPrompt(facts))}\n\n${instruction}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const text = (await response.json())?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (error) {
    log(`NEAR AI Cloud unavailable (${error.message}); using built-in wording.`);
    return null;
  }
}

async function postNote(circleId, text) {
  const note = text.replace(/\s+/g, ' ').trim().slice(0, NOTE_LIMIT);
  await call('post_note', { circle_id: circleId, text: note });
  log(`circle ${circleId}: note posted → ${note}`);
}

async function tickCircle(id) {
  let circle = await getCircle(id);
  const at = now();

  if (circle.status === STATUS.AWAITING_FINALIZE) {
    await call('finalize', { circle_id: id });
    log(`circle ${id}: finalized. Collateral refunded, fee pool shared.`);
    return;
  }
  if (circle.status !== STATUS.ACTIVE) return;

  if (at > circle.deadline_ns) {
    const round = circle.round;
    await call('settle_round', { circle_id: id });
    log(`circle ${id}: settled round ${round}.`);
    if (dryRun) return;
    circle = await getCircle(id);
    const record = circle.rounds.find((r) => r.round === round);
    if (!record) return;
    const facts = circleFacts(circle, { now: at });
    const written = await phrase({ ...facts, lastRound: record }, `Write a round report of at most 250 characters for round ${round}: who was paid, how much, and who missed.`);
    await postNote(id, written ?? roundReport(circle, record, lang));
    return;
  }

  // Round still open: one reminder per round, once at least half of the round has gone by.
  const facts = circleFacts(circle, { now: at });
  const alreadyReminded = circle.notes.some((note) => note.r === circle.round);
  const halfway = facts.timeLeftNs * 2n < circle.round_ns;
  if (facts.unpaid.length && halfway && !alreadyReminded) {
    const written = await phrase(facts, 'Write a friendly payment reminder of at most 250 characters naming who still has to pay and how long is left.');
    await postNote(id, written ?? reminderNote(facts, lang));
  }
}

async function tick() {
  const circles = await view('list_circles', { limit: 50 });
  for (const summary of circles) {
    if (summary.status === STATUS.OPEN || summary.status === STATUS.COMPLETED) continue;
    try {
      await tickCircle(summary.id);
    } catch (error) {
      log(`circle ${summary.id}: ${error.message ?? error}`);
    }
  }
}

async function main() {
  const command = args[0];
  if (!command || command === 'help' || command === '--help') {
    console.log('Usage: node agent/alajo.js <status|ask|tick|watch> … (see the header of agent/alajo.js)');
    return;
  }
  requireEnv('AJO_CONTRACT_ID');

  if (command === 'status' || command === 'ask') {
    const circle = await getCircle(args[1]);
    const facts = circleFacts(circle, { now: now(), account: flag('account') });
    const question = command === 'ask' ? String(args[2] ?? '') : 'What is the status of this circle?';
    const answer = (await phrase(facts, `Member's question: ${question}`)) ?? answerFromFacts(facts, classifyQuestion(question), lang);
    console.log(answer);
    return;
  }
  if (command === 'tick') return tick();
  if (command === 'watch') {
    const seconds = Math.max(15, Number(flag('interval', 60)));
    log(`Alajo watching ${CONTRACT_ID} every ${seconds}s as ${AGENT_ID ?? '(no agent account: views only)'}.`);
    for (;;) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
