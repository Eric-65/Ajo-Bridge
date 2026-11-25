import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  KNOWN_MINIMUM_USD, base58Decode, exactOutputRequest, minimumFromError, nearMainnetAccountProblem, nearToYocto,
  presetAmounts, quoteBreakdown, refundAddressProblem, secondsLeft, sha256, usdOfNear,
} from '../shared/oneclick.js';

const NEAR = 10n ** 24n;

test('amounts: NEAR text to yocto, presets and dollar value', () => {
  assert.equal(nearToYocto('0.5'), (NEAR / 2n).toString());
  assert.equal(nearToYocto('12,25'), (12n * NEAR + NEAR / 4n).toString());
  assert.equal(nearToYocto('0'), null);
  assert.equal(nearToYocto('-1'), null);
  assert.equal(nearToYocto('1.1234567'), null, 'more than 6 decimals is rejected');
  assert.equal(nearToYocto('abc'), null);

  const presets = presetAmounts({ contribution: NEAR / 2n, collateralGap: 9n * NEAR / 2n });
  assert.deepEqual(presets.map((p) => p.key), ['round', 'collateral', 'custom']);
  assert.equal(presets[0].yocto, NEAR / 2n, 'the default is exactly one round, not a dollar amount');
  assert.deepEqual(presetAmounts({ contribution: NEAR, collateralGap: 0n }).map((p) => p.key), ['round', 'custom']);

  assert.equal(usdOfNear(NEAR / 2n, '3.01').toFixed(3), '1.505');
  assert.equal(usdOfNear(NEAR, 0), null);
});

test('exact-output request asks 1Click for exactly the NEAR the member needs', () => {
  const body = exactOutputRequest({ originAsset: 'a', destinationAsset: 'nep141:wrap.near', yocto: NEAR / 2n, recipient: 'me.near', refundTo: '0xabc' });
  assert.equal(body.swapType, 'EXACT_OUTPUT');
  assert.equal(body.amount, '500000000000000000000000');
  assert.equal(body.dry, true, 'previews are dry unless dry: false is passed');
  assert.equal(exactOutputRequest({ dry: false, yocto: 1n }).dry, false);
});

test('route minimums are read from 1Click errors, with the measured Tron minimum as a hint', () => {
  assert.equal(minimumFromError('Temporary swap limits: minimum swap amount is $100'), 100);
  assert.equal(minimumFromError('minimum swap amount is 1,000'), 1000);
  assert.equal(minimumFromError('Amount is too low for bridge'), null);
  assert.equal(KNOWN_MINIMUM_USD['tron:USDT'], 100);
  assert.equal(KNOWN_MINIMUM_USD['base:USDC'], undefined, 'Base USDC quoted from $0.50 when measured');
});

// Recorded from a dry EXACT_OUTPUT quote for 0.5 NEAR from USDC on Base (Nov 25, 2026).
const RECORDED = {
  amountIn: '1512889', amountInFormatted: '1.512889', amountInUsd: '1.5122', minAmountIn: '1497760',
  amountOut: '500000000000000000000000', amountOutFormatted: '0.5', amountOutUsd: '1.505', minAmountOut: '500000000000000000000000',
  timeEstimate: 37, refundFee: '2400', withdrawFee: '0',
};

test('quote breakdown shows send, minimum accepted, receive, cost, refund fee and time', () => {
  const b = quoteBreakdown(RECORDED, { originDecimals: 6 });
  assert.equal(b.send, 1.512889);
  assert.equal(b.minimumAccepted, 1.49776);
  assert.equal(b.receive, 0.5);
  assert.equal(b.minimumReceived, 0.5);
  assert.equal(b.refundFee, 0.0024);
  assert.equal(b.seconds, 37);
  assert.ok(Math.abs(b.costUsd - 0.0072) < 1e-9);
  assert.equal(b.deadline, null, 'dry quotes have no deadline');
  assert.equal(quoteBreakdown(null), null);
});

test('quote expiry countdown', () => {
  const now = Date.parse('2026-11-25T10:00:00Z');
  assert.equal(secondsLeft('2026-11-25T10:10:00Z', now), 600);
  assert.equal(secondsLeft('2026-11-25T09:59:00Z', now), -60);
  assert.equal(secondsLeft(null, now), null);
});

test('sha256 matches node:crypto', () => {
  for (const input of ['', 'abc', 'x'.repeat(200)]) {
    const bytes = new TextEncoder().encode(input);
    assert.equal(Buffer.from(sha256(bytes)).toString('hex'), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('base58 decodes leading zeros and rejects bad characters', () => {
  assert.deepEqual([...base58Decode('1')], [0]);
  assert.deepEqual([...base58Decode('11')], [0, 0]);
  assert.deepEqual([...base58Decode('2')], [1]);
  assert.deepEqual([...base58Decode('z')], [57]);
  assert.equal(base58Decode('0OIl'), null);
});

test('refund address validation is chain-aware', () => {
  // EVM
  assert.equal(refundAddressProblem('evm', '0x8a55a5666d02f18e44c197c104601a32eac8dcc1'), null);
  assert.match(refundAddressProblem('evm', '0x123'), /start with 0x/);
  assert.match(refundAddressProblem('evm', 'TMHR8TC35MUoM1MYb4izP5bzLfyXaABgAn'), /not an EVM address/);
  // Tron: real base58check addresses pass, a one-character typo fails the checksum
  assert.equal(refundAddressProblem('tron', 'TMHR8TC35MUoM1MYb4izP5bzLfyXaABgAn'), null);
  assert.equal(refundAddressProblem('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), null, 'the USDT contract address is valid base58check');
  assert.match(refundAddressProblem('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), /typo/);
  assert.match(refundAddressProblem('tron', '0x8a55a5666d02f18e44c197c104601a32eac8dcc1'), /start with T/);
  // Solana: 32 bytes of base58
  assert.equal(refundAddressProblem('sol', 'HxM8VCKppf9fVMVBdj5rinWFSak9Mjrj7Byts98kfGJu'), null);
  assert.equal(refundAddressProblem('sol', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), null);
  assert.match(refundAddressProblem('sol', 'abc'), /32 to 44/);
  assert.match(refundAddressProblem('sol', '1111111111111111111111111111111111111111111'), /not a valid Solana/);
  // Empty
  assert.match(refundAddressProblem('evm', ''), /Enter the address/);
});

test('NEAR mainnet account validation', () => {
  assert.equal(nearMainnetAccountProblem('eric0xbt.near'), null);
  assert.equal(nearMainnetAccountProblem('a'.repeat(64).replace(/a/g, 'f')), null, 'implicit account');
  assert.match(nearMainnetAccountProblem('eric0xbt.testnet'), /testnet account/);
  assert.match(nearMainnetAccountProblem('eric0xbt'), /yourname\.near/);
  assert.match(nearMainnetAccountProblem('Eric.near'), /not a NEAR account/);
  assert.match(nearMainnetAccountProblem(''), /Enter your NEAR/);
});
