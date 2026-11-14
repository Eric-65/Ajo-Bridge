/**
 * App state: which backend is live (demo or testnet), who is acting, a toast
 * queue, and hooks that keep circle data fresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { accountInfo, chain, isTestnetAccount, view, wallet } from './chain.js';
import { CONTRACT_ID, ONE_NEAR, txUrl } from './config.js';
import { demo } from './demoStore.js';

const AppContext = createContext(null);

const DEMO_KEY = 'ajo-mode';
const readDemoChoice = () => { try { return sessionStorage.getItem(DEMO_KEY) === 'demo'; } catch { return false; } };

export function AppProvider({ children }) {
  const demoState = useSyncExternalStore(demo.subscribe, demo.getSnapshot);
  const [walletAccount, setWalletAccount] = useState(wallet.account);
  const [connecting, setConnecting] = useState(false);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [lastEffects, setLastEffects] = useState(null);
  const [demoChosen, setDemoChosen] = useState(readDemoChoice);
  const [rpcDown, setRpcDown] = useState(false);
  const [onboarding, setOnboarding] = useState(null); // null | { reason, account }
  const toastId = useRef(0);

  useEffect(() => wallet.subscribe(setWalletAccount), []);
  useEffect(() => { wallet.restore(); }, []);

  // Live by default: check the contract answers. If no RPC does, fall back to demo and say why.
  useEffect(() => {
    if (!CONTRACT_ID) { setRpcDown(true); return; }
    view('get_config').then(() => setRpcDown(false)).catch(() => setRpcDown(true));
  }, []);

  const mode = demoChosen || rpcDown ? 'demo' : 'testnet';
  const backend = mode === 'testnet' ? chain : demo;
  const account = mode === 'testnet' ? walletAccount : demoState.persona;

  const toast = useCallback((text, kind = 'info', href) => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-2), { id, text, kind, href }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), href ? 9000 : 5200);
  }, []);

  const tryDemo = useCallback(() => {
    try { sessionStorage.setItem(DEMO_KEY, 'demo'); } catch { /* still switches for this page */ }
    setDemoChosen(true);
  }, []);
  const goLive = useCallback(() => {
    try { sessionStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
    setDemoChosen(false);
    view('get_config').then(() => setRpcDown(false)).catch(() => setRpcDown(true));
  }, []);

  /** After connecting: wrong network, missing account or empty balance → show the testnet steps. */
  const checkAccount = useCallback(async (accountId) => {
    if (!accountId) return;
    if (!isTestnetAccount(accountId)) { setOnboarding({ reason: 'mainnet', account: accountId }); return; }
    try {
      const info = await accountInfo(accountId);
      if (!info.exists) setOnboarding({ reason: 'missing', account: accountId });
      else if (info.balance < ONE_NEAR) setOnboarding({ reason: 'empty', account: accountId, balance: info.balance });
    } catch { /* RPC down: the action itself will report it */ }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const accountId = await wallet.connect();
      if (accountId) {
        toast(`Connected as ${accountId}.`);
        checkAccount(accountId);
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      if (!/reject|cancel|closed/i.test(message)) toast(`Wallet connection failed: ${message}`, 'error');
    } finally {
      setConnecting(false);
    }
  }, [toast, checkAccount]);

  const disconnect = useCallback(() => wallet.disconnect().catch(() => {}), []);

  /** Run a contract method on whichever backend is live. Rejects with a readable message. */
  const act = useCallback(async (method, args = {}, deposit = 0n) => {
    if (mode === 'testnet' && !walletAccount) {
      connect();
      throw new Error('Connect your wallet first: viewing is free, signing needs a testnet wallet.');
    }
    let attached = deposit;
    if (mode === 'testnet' && method === 'create_circle') attached = BigInt(await chain.storageFee(Number(args.members)));
    if (mode === 'testnet' && method === 'join' && deposit === null) {
      attached = BigInt((await view('quote_slot', { circle_id: Number(args.circle_id), slot: Number(args.slot) })).collateral);
    }
    const fx = await backend.act(method, args, attached);
    setLastEffects({ id: Date.now(), circleId: args.circle_id ?? fx.value, method, events: fx.events });
    setVersion((v) => v + 1);
    if (fx.hash) toast(`Confirmed on NEAR testnet · ${fx.hash.slice(0, 10)}…`, 'info', txUrl(fx.hash));
    return fx;
  }, [backend, mode, walletAccount, connect, toast]);

  const value = useMemo(() => ({
    mode, backend, account, connecting, connect, disconnect, act, toast, toasts, lastEffects,
    version: `${version}:${mode}:${mode === 'demo' ? demoState.clockOffset : ''}:${account}`,
    demoState, walletAccount, contractConfigured: Boolean(CONTRACT_ID),
    rpcDown, demoChosen, tryDemo, goLive, onboarding, closeOnboarding: () => setOnboarding(null),
  }), [mode, backend, account, connecting, connect, disconnect, act, toast, toasts, lastEffects, version, demoState, walletAccount, rpcDown, demoChosen, tryDemo, goLive, onboarding]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

function useResource(load, deps, pollMs) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const refresh = useCallback(() => {
    let cancelled = false;
    load()
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (!cancelled) setState((s) => ({ data: s.data, error, loading: false })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (!pollMs) return undefined;
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);
  return { ...state, refresh };
}

export function useCircles() {
  const { backend, version, mode } = useApp();
  return useResource(() => backend.list(), [backend, version], mode === 'testnet' ? 15000 : 0);
}

export function useCircle(id) {
  const { backend, version, mode } = useApp();
  return useResource(() => backend.get(id), [backend, version, id], mode === 'testnet' ? 8000 : 0);
}

/** Current time in nanoseconds on the live backend's clock, re-rendering every second. */
export function useNow() {
  const { backend } = useApp();
  const [now, setNow] = useState(() => backend.now());
  useEffect(() => {
    setNow(backend.now());
    const timer = setInterval(() => setNow(backend.now()), 1000);
    return () => clearInterval(timer);
  }, [backend]);
  return now;
}

/** Every circle in full (list_circles, then get_circle for each). Used for stats and "My circles". */
export function useAllCircles() {
  const { backend, version, mode } = useApp();
  return useResource(async () => {
    const list = await backend.list();
    return Promise.all(list.map((summary) => backend.get(summary.id)));
  }, [backend, version], mode === 'testnet' ? 20000 : 0);
}
