import test from 'node:test';
import assert from 'node:assert/strict';

import alajo from '../alajo.js';
import { buildQuoteRequest } from '../quote.js';
import { contribute, createCircle, join, requiredCollateral, serializeCircle } from '../../shared/ajoEngine.js';

const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const good = { originAsset: USDC_BASE, destinationAsset: 'nep141:wrap.near', amount: '20000000', recipient: 'ada.near', refundTo: '0x000000000000000000000000000000000000dEaD' };

test('quote proxy: defaults to a dry preview and forwards only whitelisted fields', () => {
  const request = buildQuoteRequest({ ...good, appFees: [{ recipient: 'evil.near', fee: 9999 }], customRecipientMsg: 'x' });
  assert.equal(request.dry, true);
  assert.equal(request.swapType, 'EXACT_INPUT');
  assert.equal(request.recipientType, 'DESTINATION_CHAIN');
  assert.equal(request.referral, 'ajo-bridge');
  assert.equal(request.appFees, undefined, 'the browser cannot inject fee recipients');
  assert.equal(request.customRecipientMsg, undefined);
  assert.equal(buildQuoteRequest({ ...good, dry: false }).dry, false);
});

test('quote proxy: rejects malformed input before calling 1Click', () => {
  assert.throws(() => buildQuoteRequest({ ...good, amount: '1.5' }), /amount/);
  assert.throws(() => buildQuoteRequest({ ...good, amount: '0' }), /amount/);
  assert.throws(() => buildQuoteRequest({ ...good, originAsset: '' }), /assetIds/);
  assert.throws(() => buildQuoteRequest({ ...good, recipient: 'bad account!' }), /recipient/);
  assert.throws(() => buildQuoteRequest({ ...good, refundTo: undefined }), /refundTo/);
});

function fakeResponse() {
  return { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test('alajo endpoint: without a model key it answers from circle facts and says so', async () => {
  delete process.env.NEAR_AI_API_KEY;
  const { circle } = createCircle({ id: 1, creator: 'ada', name: 'Test', n: 2, contribution: 10n, coverageBps: 10000, orderFeeBps: 0, roundNs: 60n * 10n ** 9n, now: 1n });
  join(circle, { account: 'ada', slot: 1, deposit: requiredCollateral(circle, 1), now: 1n });
  join(circle, { account: 'bayo', slot: 2, deposit: requiredCollateral(circle, 2), now: 2n });
  contribute(circle, { account: 'ada', deposit: 10n, now: 3n });

  const res = fakeResponse();
  await alajo({ method: 'POST', body: { circle: JSON.parse(serializeCircle(circle)), question: 'Who has not paid?', lang: 'pcm', now: '10' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.source, 'rules');
  assert.match(res.body.answer, /bayo never pay/);

  const bad = fakeResponse();
  await alajo({ method: 'POST', body: { question: 'hi' } }, bad);
  assert.equal(bad.code, 400);
  const get = fakeResponse();
  await alajo({ method: 'GET' }, get);
  assert.equal(get.code, 405);
});
