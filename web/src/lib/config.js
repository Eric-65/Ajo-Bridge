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
/** NEAR mainnet RPC: only used to check that a payout account exists before a 1Click payment. */
export const MAINNET_RPC_URL = 'https://rpc.mainnet.fastnear.com';
export const txUrl = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;
export const ONE_NEAR = 10n ** 24n;
/** Gas the wallet may charge on top of the deposit; used only for the balance pre-check. */
export const GAS_RESERVE = ONE_NEAR / 20n;
export const EXPLORER_URL = 'https://testnet.nearblocks.io';
export const GAS = '100000000000000'; // 100 Tgas; the heaviest call measured in the sandbox used 47
export const AGENT_DEMO_ACCOUNT = 'alajo.demo';

/** The one public address of the app. Other hosts redirect here (vercel.json); invite links use it. */
export const CANONICAL_ORIGIN = 'https://ajo-bridge.vercel.app';

/**
 * Live circles left out of lists and totals. #0–#2 are duplicates of #3–#5, created by a
 * seeding run that was slowed by a rate-limited RPC. They stay reachable by direct link,
 * labelled "test circle".
 */
export const HIDDEN_CIRCLES = Object.freeze([0, 1, 2]);
export const isHiddenCircle = (id) => HIDDEN_CIRCLES.includes(Number(id));

/** Origin for links people share: the canonical site, or this machine while developing locally. */
export function inviteOrigin() {
  const { hostname, origin } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' ? origin : CANONICAL_ORIGIN;
}
