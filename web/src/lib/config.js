/** Build-time configuration. Everything here is public; secrets live only in the /api functions. */

export const NETWORK = 'testnet';
/** Deployed by .github/workflows/deploy-testnet.yml (run 43592039774). Code locked: the account has no access keys. */
export const DEPLOYED_CONTRACT_ID = 'ajobridge-circles.testnet';
export const CONTRACT_ID = import.meta.env.VITE_AJO_CONTRACT_ID || DEPLOYED_CONTRACT_ID;
export const RPC_URL = import.meta.env.VITE_NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
export const EXPLORER_URL = 'https://testnet.nearblocks.io';
export const GAS = '100000000000000'; // 100 Tgas; the heaviest call measured in the sandbox used 47
export const AGENT_DEMO_ACCOUNT = 'alajo.demo';
