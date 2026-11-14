/** Build-time configuration. Everything here is public; secrets live only in the /api functions. */

export const NETWORK = 'testnet';
/** Deployed by .github/workflows/deploy-testnet.yml (run 43592039774). Code locked: the account has no access keys. */
export const DEPLOYED_CONTRACT_ID = 'ajobridge-circles.testnet';
export const CONTRACT_ID = import.meta.env.VITE_AJO_CONTRACT_ID || DEPLOYED_CONTRACT_ID;
/** Tried in order; the next one is used when a request fails. */
export const RPC_URLS = [
  import.meta.env.VITE_NEAR_RPC_URL,
  'https://test.rpc.fastnear.com',
  'https://rpc.testnet.near.org',
].filter((url, i, all) => url && all.indexOf(url) === i);
export const RPC_URL = RPC_URLS[0];
export const txUrl = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
export const ONE_NEAR = 10n ** 24n;
/** Gas the wallet may charge on top of the deposit; used only for the balance pre-check. */
export const GAS_RESERVE = ONE_NEAR / 20n;
export const EXPLORER_URL = 'https://testnet.nearblocks.io';
export const GAS = '100000000000000'; // 100 Tgas; the heaviest call measured in the sandbox used 47
export const AGENT_DEMO_ACCOUNT = 'alajo.demo';
