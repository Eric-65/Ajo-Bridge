import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';

import { PERSONAS, demo } from '../lib/demoStore.js';
import { shortName } from '../lib/format.js';
import { useApp } from '../lib/store.jsx';
import { installRevealFallback } from '../motion/reveal.js';
import { Cta } from './ui.jsx';

const NAV = [
  { to: '/circles', label: 'Circles' },
  { to: '/create', label: 'Start a circle' },
  { to: '/simulator', label: 'Walk-away test' },
];

export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Ajo Bridge, home" viewTransition>
      <span>AJO BRIDGE</span>
      <svg className="wordmark__chev" viewBox="0 0 34 24" fill="currentColor" aria-hidden="true">
        <path d="M0 0h6l9 12-9 12H0l9-12z" />
        <path d="M9.5 0h6l9 12-9 12h-6l9-12z" />
        <path d="M19 0h6l9 12-9 12h-6l9-12z" />
      </svg>
    </Link>
  );
}

function WalletButton() {
  const { walletAccount, contractConfigured, connect, disconnect, connecting } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!walletAccount) {
    return (
      <button type="button" className="cta cta--sm wallet-btn" onClick={connect} data-busy={connecting || undefined} aria-label="Connect a NEAR testnet wallet">
        <span className="wallet-btn__long">{connecting ? 'Connecting…' : 'Connect wallet'}</span>
        <span className="wallet-btn__short" aria-hidden="true">{connecting ? '…' : 'Connect'}</span>
      </button>
    );
  }
  return (
    <div className="wallet" ref={ref}>
      <button type="button" className="status" data-state="live" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} aria-label={`Wallet ${walletAccount}. Open wallet menu.`}>
        <span className="status__dot" />
        <span className="wallet__name">{shortName(walletAccount)}</span>
      </button>
      {open ? (
        <div className="wallet__menu" role="menu">
          <p className="label">Connected</p>
          <p className="wallet__account mono">{walletAccount}</p>
          <p className="netlabel"><b data-net="testnet">testnet</b><span>{contractConfigured ? 'Using the Ajo Bridge contract' : 'Contract not deployed yet: circles show demo data'}</span></p>
          <button type="button" className="cta cta--sm cta--dark" role="menuitem" onClick={() => { setOpen(false); disconnect(); }}>Disconnect</button>
        </div>
      ) : null}
    </div>
  );
}

function Header() {
  const { walletAccount, connect, disconnect, connecting } = useApp();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <header className="header">
        <div className="wrap header__bar">
          <Wordmark />
          <div className="header__right">
            <nav className="header__nav" aria-label="Main">
              {NAV.map((item) => <NavLink key={item.to} to={item.to} viewTransition>{item.label}</NavLink>)}
            </nav>
            <WalletButton />
            <button type="button" className="burger" aria-expanded={open} aria-controls="menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
              <span /><span />
            </button>
          </div>
        </div>
      </header>
      {open ? (
        <nav id="menu" className="menu" aria-label="Menu">
          {[{ to: '/', label: 'Home' }, ...NAV].map((item, i) => (
            <NavLink key={item.to} to={item.to} style={{ '--i': i }} end viewTransition>{item.label}</NavLink>
          ))}
          <div className="menu__foot stack">
            <p className="helper">{walletAccount ? `Connected to NEAR testnet as ${walletAccount}.` : 'Connect Meteor Wallet (app, web or browser extension) on NEAR testnet. Without a wallet you can try everything on demo data.'}</p>
            <Cta onClick={walletAccount ? disconnect : connect} busy={connecting}>{walletAccount ? 'Disconnect wallet' : 'Connect wallet'}</Cta>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function DemoBanner() {
  const { mode, account, toast, walletAccount } = useApp();
  if (mode !== 'demo') return null;
  return (
    <div className="banner" role="region" aria-label="Demo mode">
      <span className="tag tag--demo">Demo data</span>
      {walletAccount ? <span>Wallet connected · contract not deployed yet</span> : null}
      <label htmlFor="persona">Acting as</label>
      <select id="persona" value={account} onChange={(event) => demo.setPersona(event.target.value)}>
        {PERSONAS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <button type="button" onClick={() => { demo.reset(); toast('Demo circles reset.'); }}>Reset demo</button>
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <p key={t.id} className="toast" data-kind={t.kind}>{t.text}</p>)}
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__grid">
        <div className="stack">
          <Wordmark />
          <p className="helper">Rotating savings circles on NEAR. Built Nov 13–14, 2026 for NEAR HACKATHON: Build Beyond Boundaries.</p>
        </div>
        <div className="stack stack--sm">
          <p className="label">What is live</p>
          <p className="helper">Circles run on a NEAR <b>testnet</b> contract. Cross-chain quotes come from NEAR Intents 1Click on <b>mainnet</b>. Without a wallet you see local <b>demo</b> data.</p>
        </div>
        <div className="stack stack--sm">
          <p className="label">Not financial advice</p>
          <p className="helper">Hackathon prototype. Unaudited. Use testnet funds only.</p>
        </div>
      </div>
    </footer>
  );
}

export function Layout() {
  const location = useLocation();
  // IntersectionObserver fallback for browsers without CSS scroll timelines; re-scan after each route change.
  useEffect(() => {
    const frame = requestAnimationFrame(() => installRevealFallback());
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />
      <DemoBanner />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
      <Toasts />
      <ScrollRestoration />
    </>
  );
}
