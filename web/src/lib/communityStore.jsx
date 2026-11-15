/** Signed-in community user and their account record, shared by every page. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { communityConfigured, ensureAccount, logOut, watchUser } from './community.js';

const CommunityContext = createContext(null);

export function CommunityProvider({ children }) {
  const [user, setUser] = useState(null);
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(!communityConfigured);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!communityConfigured) return undefined;
    let stop = () => {};
    let alive = true;
    watchUser(async (next) => {
      if (!alive) return;
      setUser(next);
      setError(null);
      if (!next) { setAccount(null); setReady(true); return; }
      try {
        setAccount(await ensureAccount(next));
      } catch (e) {
        setError(String(e?.message ?? e));
      } finally {
        setReady(true);
      }
    }).then((unsubscribe) => { stop = unsubscribe; }).catch((e) => { setError(String(e?.message ?? e)); setReady(true); });
    return () => { alive = false; stop(); };
  }, []);

  const signOut = useCallback(() => logOut().catch(() => {}), []);
  const value = useMemo(() => ({ configured: communityConfigured, user, account, setAccount, ready, error, signOut }), [user, account, ready, error, signOut]);
  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error('useCommunity must be used inside <CommunityProvider>');
  return ctx;
}
