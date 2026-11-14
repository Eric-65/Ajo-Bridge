import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';

import { near } from '../lib/format.js';
import { useApp } from '../lib/store.jsx';
import { Cta, Drawer, NetLabel } from './ui.jsx';

/** Routes offered first. Asset ids always come from the live /api/tokens list, never from here. */
const ROUTES = [
  { chain: 'base', symbol: 'USDC', label: 'USDC', where: 'on Base', family: 'evm' },
  { chain: 'tron', symbol: 'USDT', label: 'USDT', where: 'on Tron', family: 'tron' },
  { chain: 'sol', symbol: 'SOL', label: 'SOL', where: 'on Solana', family: 'sol' },
  { chain: 'sol', symbol: 'USDC', label: 'USDC', where: 'on Solana', family: 'sol' },
  { chain: 'arb', symbol: 'USDC', label: 'USDC', where: 'on Arbitrum', family: 'evm' },
  { chain: 'eth', symbol: 'USDC', label: 'USDC', where: 'on Ethereum', family: 'evm' },
];

/** Syntactically valid placeholder refund addresses, used ONLY for dry (preview) quotes. */
const PREVIEW_REFUND = {
  evm: '0x000000000000000000000000000000000000dEaD',
  sol: '11111111111111111111111111111111',
  tron: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
};
const ADDRESS_HINT = { evm: '0x… address you are paying from', sol: 'Solana address you are paying from', tron: 'T… Tron address you are paying from' };
const ADDRESS_RE = { evm: /^0x[0-9a-fA-F]{40}$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ };
const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const STEPS = [
  { key: 'PENDING_DEPOSIT', label: 'Waiting for deposit' },
  { key: 'PROCESSING', label: 'Swapping' },
  { key: 'SUCCESS', label: 'Delivered' },
];
const TERMINAL = ['SUCCESS', 'REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'];

function toSmallestUnit(usd, token) {
  const price = Number(token.price) || 1;
  const units = (usd / price) * 10 ** Math.min(token.decimals, 12);
  return (BigInt(Math.round(units)) * 10n ** BigInt(Math.max(0, token.decimals - 12))).toString();
}

async function postQuote(body) {
  const response = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Quote failed (${response.status})`);
  return data;
}

/**
 * Pay from any chain: live NEAR Intents 1Click quote (MAINNET), then a deposit
 * address with QR code and a status tracker. The circle itself is on testnet,
 * and the drawer says so wherever money is involved.
 */
export function PayDrawer({ circle, onClose }) {
  const { account } = useApp();
  const [tokens, setTokens] = useState(null);
  const [tokensError, setTokensError] = useState(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [usd, setUsd] = useState('20');
  const [recipient, setRecipient] = useState(account?.endsWith('.near') ? account : '');
  const [refundTo, setRefundTo] = useState('');
  const [preview, setPreview] = useState({ state: 'idle' });
  const [deposit, setDeposit] = useState(null);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    fetch('/api/tokens')
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `status ${r.status}`); return r.json(); })
      .then((list) => { if (!Array.isArray(list)) throw new Error('unexpected token list'); setTokens(list); })
      .catch((e) => setTokensError(e.message));
  }, []);

  const find = (chain, symbol) => tokens?.find((t) => t.blockchain === chain && t.symbol?.toLowerCase() === symbol.toLowerCase());
  const routes = useMemo(() => ROUTES.map((r) => ({ ...r, token: find(r.chain, r.symbol) })).filter((r) => r.token), [tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  const destination = useMemo(() => find('near', 'wNEAR') ?? find('near', 'NEAR'), [tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  const route = routes[Math.min(routeIndex, Math.max(0, routes.length - 1))];
  const usdValue = Number(usd);

  // Live preview quote, debounced. dry: true never commits anything.
  useEffect(() => {
    if (!route || !destination || deposit) return undefined;
    if (!(usdValue > 0) || usdValue > 100000) { setPreview({ state: 'idle' }); return undefined; }
    const id = ++requestId.current;
    setPreview((p) => ({ ...p, state: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const data = await postQuote({
          dry: true,
          originAsset: route.token.assetId,
          destinationAsset: destination.assetId,
          amount: toSmallestUnit(usdValue, route.token),
          recipient: NEAR_ACCOUNT_RE.test(recipient) ? recipient : 'near',
          refundTo: ADDRESS_RE[route.family].test(refundTo) ? refundTo : PREVIEW_REFUND[route.family],
        });
        if (id === requestId.current) setPreview({ state: 'ready', quote: data.quote });
      } catch (e) {
        if (id === requestId.current) setPreview({ state: 'error', message: e.message });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [route?.token?.assetId, destination?.assetId, usd, recipient, refundTo, deposit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll the swap status once a deposit address exists.
  useEffect(() => {
    if (!deposit) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(deposit.depositAddress)}`);
        if (r.ok) {
          const data = await r.json();
          if (!stopped) setStatus(data.status);
          if (TERMINAL.includes(data.status)) return;
        }
      } catch { /* keep polling */ }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    let timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [deposit]);

  const canCommit = route && destination && usdValue > 0 && NEAR_ACCOUNT_RE.test(recipient) && ADDRESS_RE[route.family].test(refundTo);

  async function commit() {
    if (!canCommit || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const data = await postQuote({
        dry: false,
        originAsset: route.token.assetId,
        destinationAsset: destination.assetId,
        amount: toSmallestUnit(usdValue, route.token),
        recipient,
        refundTo,
      });
      if (!data.quote?.depositAddress) throw new Error('1Click did not return a deposit address');
      setDeposit(data.quote);
      setStatus('PENDING_DEPOSIT');
      setQr(await QRCode.toDataURL(data.quote.depositAddress, { margin: 0, width: 360, color: { dark: '#0e0e0e', light: '#ffffff' } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = status === 'SUCCESS' ? 2 : status === 'PROCESSING' || status === 'KNOWN_DEPOSIT_TX' ? 1 : 0;
  const failed = status === 'REFUNDED' || status === 'FAILED' || status === 'INCOMPLETE_DEPOSIT';
  const q = preview.quote;

  return (
    <Drawer title="Pay from any chain" onClose={onClose}>
      <NetLabel net="mainnet">Quotes and deposits use NEAR Intents 1Click on mainnet: real funds.</NetLabel>
      <NetLabel net="testnet">This circle runs on testnet. A mainnet payment lands in your mainnet NEAR account; it does not pay the testnet round by itself.</NetLabel>

      {tokensError ? (
        <div className="stack">
          <p className="danger" role="alert">Live quotes are unavailable right now: {tokensError}.</p>
          <p className="helper">Nothing is simulated here. Quotes appear when the 1Click API is reachable from this deployment.</p>
        </div>
      ) : null}
      {!tokens && !tokensError ? <div className="skeleton" style={{ height: '8rem' }} aria-label="Loading routes" /> : null}

      {tokens && route && !deposit ? (
        <>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: '0.5rem' }}>Pay with</legend>
            <div className="choice choice--3">
              {routes.map((r, i) => (
                <label key={`${r.chain}-${r.symbol}`}>
                  <input type="radio" name="route" checked={i === routeIndex} onChange={() => setRouteIndex(i)} />
                  <b>{r.label}</b><small>{r.where}</small>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label className="field__label" htmlFor="pay-usd">Amount (US dollars)</label>
            <input id="pay-usd" className="input" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />
            <span className="field__hint">One round of this circle is {near(circle.contribution)} NEAR.</span>
          </div>

          <div className="card card--dark card--flat" aria-live="polite" style={{ background: 'var(--black)' }}>
            {preview.state === 'loading' && !q ? <div className="skeleton" style={{ height: '4.5rem', background: 'var(--ink-2)' }} /> : null}
            {preview.state === 'error' ? <p className="danger" role="alert">No quote: {preview.message}</p> : null}
            {q && preview.state !== 'error' ? (
              <div className="stack stack--sm">
                <p className="label">Live quote</p>
                <p><span className="numeral mint">{Number(q.amountOutFormatted).toFixed(3)}</span> <span className="stat__unit">NEAR lands for your circle</span></p>
                <p className="helper">Pay {q.amountInFormatted} {route.label} {route.where} (≈ ${Number(q.amountInUsd).toFixed(2)}) · about {q.timeEstimate}s{q.minAmountOut ? ` · at least ${(Number(q.minAmountOut) / 1e24).toFixed(3)} NEAR after 1% slippage` : ''}</p>
              </div>
            ) : null}
            {preview.state === 'idle' ? <p className="helper">Enter an amount to see a live quote.</p> : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-recipient">Your NEAR mainnet account</label>
            <input id="pay-recipient" className="input mono" style={{ fontSize: '1rem' }} placeholder="you.near" autoCapitalize="none" spellCheck={false} value={recipient} onChange={(e) => setRecipient(e.target.value.trim().toLowerCase())} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pay-refund">Refund address</label>
            <input id="pay-refund" className="input mono" style={{ fontSize: '1rem' }} placeholder={ADDRESS_HINT[route.family]} autoCapitalize="none" spellCheck={false} value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} />
            <span className="field__hint">If the swap cannot complete, 1Click refunds here. Never use an exchange deposit address.</span>
          </div>
          {error ? <p className="danger" role="alert">{error}</p> : null}
          <Cta size="lg" busy={committing} disabled={!canCommit || undefined} onClick={commit}>Get deposit address</Cta>
          <p className="helper">This commits a real mainnet quote, valid for about ten minutes. Nothing moves until you send funds to the address.</p>
        </>
      ) : null}

      {deposit ? (
        <>
          <ol className="steps" aria-label="Payment status">
            {STEPS.map((s, i) => (
              <li key={s.key} data-state={failed ? (i === 0 ? 'failed' : undefined) : i < stepIndex || status === 'SUCCESS' ? 'done' : i === stepIndex ? 'current' : undefined}>
                {failed && i === 0 ? status.replace('_', ' ') : s.label}
              </li>
            ))}
          </ol>
          <p className="label" aria-live="polite">Status: {status ?? '…'}</p>
          <p className="subtitle" style={{ color: '#e6e6e6' }}>Send exactly {deposit.amountInFormatted} {route.label} {route.where} to:</p>
          {qr ? <div className="qr"><img src={qr} alt={`QR code of the deposit address ${deposit.depositAddress}`} /></div> : null}
          <div className="copy">
            <code>{deposit.depositAddress}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(deposit.depositAddress)}>Copy</button>
          </div>
          {deposit.depositMemo ? <p className="danger">Memo required: {deposit.depositMemo}</p> : null}
          <p className="helper">You receive about {Number(deposit.amountOutFormatted).toFixed(3)} NEAR in {recipient}. Deposit before {new Date(deposit.deadline).toLocaleTimeString()}. If it fails, funds return to your refund address.</p>
          <Cta variant="ghost" size="sm" onClick={() => { setDeposit(null); setStatus(null); setQr(''); }}>Start over</Cta>
        </>
      ) : null}
    </Drawer>
  );
}
