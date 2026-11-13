/** Small helpers shared by the sandbox tests. */
import { Worker } from 'near-workspaces';

export const GAS = '300000000000000';
export const ROUND_SECS = 30;

/** NEAR -> yoctoNEAR string (3 decimal places are plenty for tests). */
export const N = (near) => (BigInt(Math.round(near * 1000)) * 10n ** 21n).toString();
export const toNear = (yocto) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;

export async function startSandbox() {
  const worker = await Worker.init();
  const root = worker.rootAccount;
  const contract = await root.devDeploy('build/ajo_bridge.wasm', { initialBalance: N(30) });
  const owner = await root.createSubAccount('owner', { initialBalance: N(50) });
  const agent = await root.createSubAccount('alajo', { initialBalance: N(50) });
  await owner.call(contract, 'init', { owner: owner.accountId, agent: agent.accountId });
  return { worker, root, contract, owner, agent };
}

let counter = 0;
export async function newAccounts(root, names, near = 400) {
  const batch = ++counter;
  return Promise.all(names.map((name) => root.createSubAccount(`${name}${batch}`, { initialBalance: N(near) })));
}

/** Call a change method; throw with the contract's panic message if it failed. */
export async function call(account, contract, method, args = {}, deposit = '0') {
  const outcome = await account.callRaw(contract, method, args, { gas: GAS, attachedDeposit: deposit });
  const status = outcome.result.status;
  if (status.Failure) throw new Error(JSON.stringify(status.Failure));
  const gas = outcome.result.receipts_outcome.reduce((sum, r) => sum + BigInt(r.outcome.gas_burnt), 0n);
  return { value: outcome.parseResult(), logs: outcome.logs, events: parseEvents(outcome.logs), gasTgas: Number(gas / 10n ** 9n) / 1000 };
}

export function parseEvents(logs) {
  return logs.filter((line) => line.startsWith('EVENT_JSON:')).map((line) => JSON.parse(line.slice('EVENT_JSON:'.length)));
}

export async function balance(account) {
  return BigInt((await account.balance()).total.toString());
}

export async function createCircle(creator, contract, terms) {
  const fee = await contract.view('storage_fee', { members: terms.members });
  const { value } = await call(creator, contract, 'create_circle', { round_secs: ROUND_SECS, name: 'Test circle', ...terms }, fee);
  return value;
}

export const getCircle = (contract, id) => contract.view('get_circle', { circle_id: id });

/** Fast-forward the sandbox until the current round's deadline has passed. */
export async function passDeadline(worker, contract, id) {
  for (let i = 0; i < 20; i++) {
    const circle = await getCircle(contract, id);
    if (BigInt(circle.now_ns) > BigInt(circle.deadline_ns)) return;
    await worker.provider.fastForward(30);
  }
  throw new Error('deadline did not pass');
}
