/**
 * NEAR testnet backend: view calls straight to the RPC, change calls through
 * the connected wallet (@hot-labs/near-connect). On testnet the picker offers Meteor Wallet,
 * Intear, Nightly, Ledger and others; NEAR Mobile is mainnet-only in the connector's manifest.
 */
import { deserializeCircle } from '@shared/ajoEngine.js';

import { CONTRACT_ID, GAS, GAS_RESERVE, NETWORK, RPC_URLS, isHiddenCircle } from './config.js';

const LIST_PAGE = 50; // the contract's list_circles maximum

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

/** JSON-RPC call with fallback: tries each RPC in RPC_URLS until one answers. */
async function rpc(method, params) {
  let lastError;
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'ajo', method, params }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`NEAR RPC ${new URL(url).host} answered ${response.status}`);
      const body = await response.json();
      if (body.error) {
        const cause = body.error.cause?.name;
        // UNKNOWN_ACCOUNT and contract panics are real answers: do not retry them elsewhere.
        if (cause === 'UNKNOWN_ACCOUNT') return { unknownAccount: true };
        throw new Error(body.error.data ?? body.error.message ?? 'RPC error');
      }
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('No NEAR RPC endpoint answered');
}

export async function view(method, args = {}) {
  const result = await rpc('query', {
    request_type: 'call_function',
    finality: 'optimistic',
    account_id: CONTRACT_ID,
    method_name: method,
    args_base64: toBase64(encoder.encode(JSON.stringify(args))),
  });
  if (result?.error) throw new Error(cleanPanic(result.error));
  return JSON.parse(decoder.decode(Uint8Array.from(result.result)));
}

/** Account state on testnet: { exists, balance } (balance = available yoctoNEAR). */
export async function accountInfo(accountId) {
  const result = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
  if (!result || result.unknownAccount) return { exists: false, balance: 0n };
  return { exists: true, balance: BigInt(result.amount ?? 0) };
}

export const isTestnetAccount = (id) => /\.testnet$/.test(id ?? '') || /^[0-9a-f]{64}$/.test(id ?? '');

/** Turn wallet and RPC failures into one plain sentence. */
export function friendlyError(error) {
  const text = cleanPanic(error?.message ?? String(error));
  if (/reject|denied|cancel|closed|user.*abort/i.test(text)) return 'You rejected the transaction in your wallet. Nothing was sent.';
  if (/NotEnoughBalance|LackBalanceForState|not enough balance|insufficient/i.test(text)) return 'Not enough testnet NEAR in your wallet for this deposit plus gas. Get free testnet NEAR from a faucet and try again.';
  if (/already taken/i.test(text)) return `${text}. Pick another open slot.`;
  if (/joining is closed|already started/i.test(text)) return 'This circle has already started, so it no longer accepts members.';
  return text;
}

/** "Smart contract panicked: attach at least…\n at fail (…)" → "attach at least…" */
export function cleanPanic(message) {
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  const match = text.match(/Smart contract panicked: ([^\\\n"]+)/);
  return match ? match[1].trim() : text;
}

// ------------------------------------------------------------------ wallet

let connectorPromise = null;
const walletListeners = new Set();
let walletAccount = null;

function setAccount(accountId) {
  walletAccount = accountId;
  walletListeners.forEach((fn) => fn(accountId));
}

/** The connector is loaded on demand so demo mode never downloads wallet code. */
function connector() {
  connectorPromise ??= import('@hot-labs/near-connect').then(({ NearConnector }) => {
    const instance = new NearConnector({ network: NETWORK, features: { testnet: true } });
    instance.on('wallet:signIn', ({ accounts }) => setAccount(accounts?.[0]?.accountId ?? null));
    instance.on('wallet:signOut', () => setAccount(null));
    return instance;
  });
  return connectorPromise;
}

export const wallet = {
  subscribe(fn) {
    walletListeners.add(fn);
    return () => walletListeners.delete(fn);
  },
  get account() { return walletAccount; },

  /** Restore a previous session, if the user connected before. */
  async restore() {
    if (!localStorage.getItem('ajo-wallet-used')) return null;
    try {
      const c = await connector();
      const w = await c.wallet();
      const accounts = await w.getAccounts();
      setAccount(accounts?.[0]?.accountId ?? null);
    } catch { /* not signed in */ }
    return walletAccount;
  },

  /** Opens the wallet picker. Works without a deployed contract: circles stay on demo data until one is configured. */
  async connect() {
    const c = await connector();
    const w = await c.connect();
    const accounts = await w.getAccounts();
    localStorage.setItem('ajo-wallet-used', '1');
    setAccount(accounts?.[0]?.accountId ?? null);
    return walletAccount;
  },

  async disconnect() {
    const c = await connector();
    await c.disconnect();
    localStorage.removeItem('ajo-wallet-used');
    setAccount(null);
  },
};

function eventsFromOutcome(outcome) {
  const logs = (outcome?.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []);
  return logs
    .filter((line) => line.startsWith('EVENT_JSON:'))
    .map((line) => {
      const parsed = JSON.parse(line.slice('EVENT_JSON:'.length));
      return { event: parsed.event, data: parsed.data?.[0] ?? {} };
    });
}

export const chain = {
  now: () => BigInt(Date.now()) * 1_000_000n,
  get account() { return walletAccount; },

  /** Every listed circle, page by page, without the hidden test circles. */
  async list() {
    // list_circles walks down from from_index (newest first when omitted).
    const all = [];
    let args = { limit: LIST_PAGE };
    for (;;) {
      const page = await view('list_circles', args);
      all.push(...page);
      const lowest = page.at(-1)?.id;
      if (page.length < LIST_PAGE || !lowest) break;
      args = { from_index: lowest - 1, limit: LIST_PAGE };
    }
    return all.filter((c) => !isHiddenCircle(c.id)).sort((a, b) => b.id - a.id);
  },

  async get(id) {
    const raw = await view('get_circle', { circle_id: Number(id) });
    return deserializeCircle(JSON.stringify(raw));
  },

  storageFee: (members) => view('storage_fee', { members }),

  /** Sign and send one function call with the connected wallet. */
  async act(method, args = {}, deposit = 0n) {
    if (!walletAccount) throw new Error('Connect your wallet to sign this transaction.');
    if (!isTestnetAccount(walletAccount)) {
      throw new Error(`${walletAccount} is a mainnet account. Ajo Bridge runs on NEAR testnet: switch your wallet to testnet (an account ending in .testnet) and reconnect.`);
    }
    const info = await accountInfo(walletAccount).catch(() => null);
    if (info && (!info.exists || info.balance < BigInt(deposit) + GAS_RESERVE)) {
      throw new Error('Not enough testnet NEAR in your wallet for this deposit plus gas. Get free testnet NEAR from a faucet and try again.');
    }
    const c = await connector();
    const w = await c.wallet();
    let outcome;
    try {
      outcome = await w.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: GAS, deposit: deposit.toString() } }],
      });
    } catch (error) {
      throw new Error(friendlyError(error));
    }
    const failure = outcome?.status?.Failure;
    if (failure) throw new Error(friendlyError({ message: JSON.stringify(failure) }));
    let value = null;
    const success = outcome?.status?.SuccessValue;
    if (success) {
      try { value = JSON.parse(atob(success)); } catch { value = null; }
    }
    return { value, events: eventsFromOutcome(outcome), transfers: [], hash: outcome?.transaction?.hash };
  },
};
