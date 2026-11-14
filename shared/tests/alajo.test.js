import test from 'node:test';
import assert from 'node:assert/strict';

import { contribute, createCircle, finalize, join, requiredCollateral, settleRound } from '../ajoEngine.js';
import { answerFromFacts, circleFacts, classifyQuestion, factsForPrompt, humanDuration, reminderNote, roundReport, systemPrompt } from '../alajo.js';

const SECOND = 1_000_000_000n;
const NEAR = 10n ** 24n;
const names = ['ada.testnet', 'bayo.testnet', 'chidi.testnet'];

function running() {
  const { circle } = createCircle({ id: 3, creator: names[0], name: 'Market women', n: 3, contribution: 20n * NEAR, coverageBps: 10000, orderFeeBps: 100, roundNs: 3600n * SECOND, now: 0n });
  names.forEach((account, i) => join(circle, { account, slot: i + 1, deposit: requiredCollateral(circle, i + 1), now: 1n }));
  return circle;
}

test('facts: who has not paid, who collects, how long is left', () => {
  const circle = running();
  contribute(circle, { account: names[1], deposit: 20n * NEAR, now: 10n });
  const facts = circleFacts(circle, { now: 600n * SECOND, account: names[2] });
  assert.equal(facts.recipient, 'ada.testnet');
  assert.deepEqual(facts.unpaid, ['chidi.testnet'], 'the recipient is not chased for their own round');
  assert.equal(facts.pastDeadline, false);
  assert.equal(humanDuration(facts.timeLeftNs), '50 minutes');
  assert.equal(facts.me.slot, 3);
  assert.equal(facts.me.roundsUntilTurn, 2);
  assert.equal(facts.me.paidThisRound, false);
});

test('questions are routed to intents in English, Pidgin and Yoruba', () => {
  assert.equal(classifyQuestion("Who hasn't paid?"), 'unpaid');
  assert.equal(classifyQuestion('Who never pay?'), 'unpaid');
  assert.equal(classifyQuestion('When is my turn?'), 'turn');
  assert.equal(classifyQuestion('What happens if I miss?'), 'miss');
  assert.equal(classifyQuestion('Wetin go happen if I no pay?'), 'miss');
  assert.equal(classifyQuestion('Can the collector run with the pot?'), 'safety');
  assert.equal(classifyQuestion('hello'), 'status');
});

test('answers quote real numbers from the circle in all three languages', () => {
  const circle = running();
  contribute(circle, { account: names[1], deposit: 20n * NEAR, now: 10n });
  const facts = circleFacts(circle, { now: 600n * SECOND, account: names[2] });
  assert.match(answerFromFacts(facts, 'unpaid', 'en'), /chidi has not paid 20 NEAR yet\. 50 minutes left\. ada collects/);
  assert.match(answerFromFacts(facts, 'unpaid', 'pcm'), /chidi never pay 20 NEAR/);
  assert.match(answerFromFacts(facts, 'unpaid', 'yo'), /chidi kò tíì san 20 NEAR/);
  assert.match(answerFromFacts(facts, 'turn', 'en'), /slot 3\. You collect in 2 rounds: about 60 NEAR/);
  assert.match(answerFromFacts(facts, 'miss', 'en'), /20 NEAR is taken from your collateral \(you have 20 NEAR locked\)/);
  assert.match(answerFromFacts(facts, 'safety', 'en'), /no withdraw function/);
  assert.match(answerFromFacts(circleFacts(circle, { now: 1n, account: 'stranger.testnet' }), 'turn', 'en'), /not a member/);
  assert.equal(answerFromFacts(facts, 'unpaid', 'xx'), answerFromFacts(facts, 'unpaid', 'en'), 'unknown language falls back to English');
});

test('reminder and round report fit the contract\'s 280-character note limit', () => {
  const circle = running();
  contribute(circle, { account: names[1], deposit: 20n * NEAR, now: 10n });
  const note = reminderNote(circleFacts(circle, { now: 600n * SECOND }), 'pcm');
  assert.match(note, /chidi, abeg pay 20 NEAR/);
  assert.ok(note.length <= 280);

  settleRound(circle, { now: circle.deadline_ns });
  const report = roundReport(circle, circle.rounds[0], 'en');
  assert.match(report, /Round 1 report: ada was paid 39\.60 NEAR\. Missed: chidi; collateral covered it\./);
  assert.ok(report.length <= 280);
  assert.equal(reminderNote(circleFacts({ ...circle, status: 'COMPLETED' }, { now: 0n }), 'en'), null);
});

test('after the deadline, and when the circle is not running', () => {
  const circle = running();
  const late = circleFacts(circle, { now: circle.deadline_ns + 1n });
  assert.equal(late.pastDeadline, true);
  assert.match(answerFromFacts(late, 'unpaid', 'en'), /deadline has passed, so anyone can settle/);

  for (let round = 1; round <= 3; round++) settleRound(circle, { now: circle.deadline_ns });
  assert.match(answerFromFacts(circleFacts(circle, { now: 0n }), 'unpaid', 'en'), /Anyone can now close it/);
  finalize(circle, { now: 0n });
  assert.match(answerFromFacts(circleFacts(circle, { now: 0n }), 'status', 'en'), /is finished/);
});

test('prompt payload is JSON-safe and the system prompt pins the model to the facts', () => {
  const facts = circleFacts(running(), { now: 0n, account: names[0] });
  const payload = factsForPrompt(facts);
  assert.equal(payload.contribution, '20 NEAR');
  assert.equal(payload.timeLeftNs, '60 minutes');
  assert.doesNotThrow(() => JSON.stringify(payload));
  assert.match(systemPrompt('pcm'), /Nigerian Pidgin/);
  assert.match(systemPrompt('en'), /Use ONLY the facts/);
  assert.match(systemPrompt('en'), /cannot move money/);
});
