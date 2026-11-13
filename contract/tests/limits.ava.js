/** Worst-case gas and storage for the largest circle the contract accepts. */
import test from 'ava';

import { slotCollateral } from '../../shared/ajoMath.js';
import { N, call, createCircle, getCircle, newAccounts, passDeadline, startSandbox } from './helpers.js';

test.before(async (t) => {
  t.context = await startSandbox();
});

test.after.always(async (t) => {
  await t.context.worker?.tearDown();
});

const termsOf = (n, c, coverageBps, orderFeeBps) => ({ n, contribution: BigInt(N(c)), coverageBps, orderFeeBps });

// ---------------------------------------------------------------------------

test.serial('gas and storage: a full 12-member circle where nobody ever pays stays within limits', async (t) => {
  const { root, contract, worker } = t.context;
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  const members = await newAccounts(root, names, 200);
  const terms = termsOf(12, 1, 10000, 100);
  const storageBefore = (await contract.accountView()).storage_usage;
  const id = await createCircle(members[0], contract, { members: 12, contribution: N(1), coverage_bps: 10000, order_fee_bps: 100 });
  let maxGas = 0;
  const track = (label, outcome) => { maxGas = Math.max(maxGas, outcome.gasTgas); t.log(`${label}: ${outcome.gasTgas} Tgas`); };

  for (let i = 0; i < 12; i++) {
    const outcome = await call(members[i], contract, 'join', { circle_id: id, slot: i + 1 }, slotCollateral(terms, i + 1).toString());
    if (i === 11) track('join (starts the circle)', outcome);
  }
  for (let round = 1; round <= 12; round++) {
    await passDeadline(worker, contract, id);
    const outcome = await call(members[0], contract, 'settle_round', { circle_id: id });
    if (round === 1 || round === 6 || round === 12) track(`settle_round ${round} (11 members slashed)`, outcome);
    maxGas = Math.max(maxGas, outcome.gasTgas);
  }
  track('finalize', await call(members[0], contract, 'finalize', { circle_id: id }));

  const circle = await getCircle(contract, id);
  t.is(circle.status, 'COMPLETED');
  t.is(circle.escrow, '0');
  t.true(maxGas < 150, `heaviest call used ${maxGas} Tgas (limit 300)`);

  const used = (await contract.accountView()).storage_usage - storageBefore;
  const config = await contract.view('get_config');
  const reserved = Number(config.storage_base_bytes) + 12 * Number(config.storage_bytes_per_member);
  t.log(`storage used by the circle: ${used} bytes, paid for: ${reserved} bytes`);
  t.true(used <= reserved, 'the storage fee covers the circle\'s whole life');
});
