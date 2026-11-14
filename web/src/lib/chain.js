/**
 * NEAR testnet backend: view calls straight to the RPC, change calls through
 * the connected wallet (@hot-labs/near-connect: Meteor Wallet, NEAR Mobile, …).
 */
import { deserializeCircle } from '@shared/ajoEngine.js';

import { CONTRACT_ID, GAS, NETWORK, RPC_URL } from './config.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

export async function view(method, args = {}) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'ajo',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: CONTRACT_ID,
        method_name: method,
        args_base64: toBase64(encoder.encode(JSON.stringify(args))),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.data ?? body.error.message ?? 'RPC error');
  if (body.result?.error) throw new Error(cleanPanic(body.result.error));
  return JSON.parse(decoder.decode(Uint8Array.from(body.result.result)));
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

  /** Opens the wallet picker (Meteor Wallet and NEAR Mobile are in the list on testnet). */
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

  list: () => view('list_circles', { limit: 30 }),

  async get(id) {
    const raw = await view('get_circle', { circle_id: Number(id) });
    return deserializeCircle(JSON.stringify(raw));
  },

  storageFee: (members) => view('storage_fee', { members }),

  /** Sign and send one function call with the connected wallet. */
  async act(method, args = {}, deposit = 0n) {
    const c = await connector();
    const w = await c.wallet();
    let outcome;
    try {
      outcome = await w.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: GAS, deposit: deposit.toString() } }],
      });
    } catch (error) {
      throw new Error(cleanPanic(error?.message ?? String(error)));
    }
    const failure = outcome?.status?.Failure;
    if (failure) throw new Error(cleanPanic(failure));
    let value = null;
    const success = outcome?.status?.SuccessValue;
    if (success) {
      try { value = JSON.parse(atob(success)); } catch { value = null; }
    }
    return { value, events: eventsFromOutcome(outcome), transfers: [], hash: outcome?.transaction?.hash };
  },
};
