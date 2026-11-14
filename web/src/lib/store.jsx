/**
 * App state: which backend is live (demo or testnet), who is acting, a toast
 * queue, and hooks that keep circle data fresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { chain, wallet } from './chain.js';
import { CONTRACT_ID } from './config.js';
import { demo } from './demoStore.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const demoState = useSyncExternalStore(demo.subscribe, demo.getSnapshot);
  const [walletAccount, setWalletAccount] = useState(wallet.account);
  const [connecting, setConnecting] = useState(false);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [lastEffects, setLastEffects] = useState(null);
  const toastId = useRef(0);

  useEffect(() => wallet.subscribe(setWalletAccount), []);
  useEffect(() => { wallet.restore(); }, []);

  const mode = walletAccount && CONTRACT_ID ? 'testnet' : 'demo';
  const backend = mode === 'testnet' ? chain : demo;
  const account = mode === 'testnet' ? walletAccount : demoState.persona;

  const toast = useCallback((text, kind = 'info') => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5200);
  }, []);

  const connect = useCallback(async () => {
    if (!CONTRACT_ID) {
      toast('No contract address is configured (VITE_AJO_CONTRACT_ID). You are on demo data.', 'error');
      return;
    }
    setConnecting(true);
    try {
      await wallet.connect();
    } catch (error) {
      toast(`Wallet connection failed: ${error.message ?? error}`, 'error');
    } finally {
      setConnecting(false);
    }
  }, [toast]);

  const disconnect = useCallback(() => wallet.disconnect().catch(() => {}), []);

  /** Run a contract method on whichever backend is live. Rejects with a readable message. */
  const act = useCallback(async (method, args = {}, deposit = 0n) => {
    let attached = deposit;
    if (mode === 'testnet' && method === 'create_circle') attached = BigInt(await chain.storageFee(Number(args.members)));
    const fx = await backend.act(method, args, attached);
    setLastEffects({ id: Date.now(), circleId: args.circle_id ?? fx.value, method, events: fx.events });
    setVersion((v) => v + 1);
    return fx;
  }, [backend, mode]);

  const value = useMemo(() => ({
    mode, backend, account, connecting, connect, disconnect, act, toast, toasts, lastEffects,
    version: `${version}:${mode}:${mode === 'demo' ? demoState.clockOffset : ''}:${account}`,
    demoState, walletAccount, contractConfigured: Boolean(CONTRACT_ID),
  }), [mode, backend, account, connecting, connect, disconnect, act, toast, toasts, lastEffects, version, demoState, walletAccount]);

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
