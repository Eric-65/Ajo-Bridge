import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';

import { STATUS, collateralOf, requiredCollateral } from '@shared/ajoEngine.js';
import {
  KNOWN_MINIMUM_USD, PREVIEW_REFRESH_S, PREVIEW_STALE_S, REFUND_PLACEHOLDER, ROUTES, exactOutputRequest, minimumFromError,
  nearMainnetAccountProblem, nearToYocto, presetAmounts, quoteBreakdown, refundAddressProblem, secondsLeft, usdOfNear,
} from '@shared/oneclick.js';
import { PREVIEW_RECIPIENT, PREVIEW_REFUND } from '@shared/oneclickPreview.js';

import { MAINNET_RPC_URL } from '../lib/config.js';
import { near } from '../lib/format.js';
import { useApp } from '../lib/store.jsx';
import { Cta, Drawer, NetLabel } from './ui.jsx';

const STEPS = [
  { key: 'PENDING_DEPOSIT', label: 'Waiting for deposit' },
  { key: 'PROCESSING', label: 'Swapping' },
  { key: 'SUCCESS', label: 'Delivered' },
];
const TERMINAL = ['SUCCESS', 'REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'];
const MEMORY_KEY = 'ajo-pay-v1';

const remembered = () => { try { return JSON.parse(localStorage.getItem(MEMORY_KEY)) ?? {}; } catch { return {}; } };
const remember = (value) => { try { localStorage.setItem(MEMORY_KEY, JSON.stringify(value)); } catch { /* private mode */ } };
const money = (n, digits = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits));
const amount = (n) => (n === null || n === undefined ? '—' : Number(n.toPrecision(6)).toString());

async function postQuote(body) {
  const response = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Quote failed (${response.status})`);
  return data;
}

/** true / false when NEAR mainnet answers, null when it could not be checked. */
async function mainnetAccountExists(accountId) {
  try {
    const response = await fetch(MAINNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'ajo', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } }),
    });
    const data = await response.json();
    if (data.result) return true;
    const text = JSON.stringify(data.error ?? data.result?.error ?? '');
    return /UNKNOWN_ACCOUNT|does not exist/i.test(text) ? false : null;
  } catch {
    return null;
  }
}

/**
 * Pay from any chain: a live NEAR Intents 1Click quote on MAINNET for exactly the NEAR a
 * member needs, then a deposit address with QR code and a status tracker. The circle is on
 * testnet: the NEAR lands in the payer's own NEAR mainnet account, and the drawer says so.
 */
export function PayDrawer({ circle, onClose }) {
  const { account, walletAccount } = useApp();
  const memory = useMemo(remembered, []);
  const [tokens, setTokens] = useState(null);
  const [tokensError, setTokensError] = useState(null);
  const [routeKey, setRouteKey] = useState(memory.route ?? ROUTES[0].key);
  const [presetKey, setPresetKey] = useState('round');
  const [custom, setCustom] = useState('');
  const [recipient, setRecipient] = useState(walletAccount?.endsWith('.near') ? walletAccount : memory.recipient ?? '');
  const [refunds, setRefunds] = useState(memory.refunds ?? {});
  const [exists, setExists] = useState(null); // null unknown · true · false
  const [preview, setPreview] = useState({ state: 'idle' });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmed, setConfirmed] = useState(false);
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
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(t); }, []);

  const find = (chain, symbol) => tokens?.find((t) => t.blockchain === chain && t.symbol?.toLowerCase() === symbol.toLowerCase());
  const routes = useMemo(() => ROUTES.map((r) => ({ ...r, token: find(r.chain, r.symbol) })).filter((r) => r.token), [tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  const destination = useMemo(() => find('near', 'wNEAR'), [tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  const route = routes.find((r) => r.key === routeKey) ?? routes[0];
  const refundTo = route ? refunds[route.family] ?? '' : '';

  // What this member needs: one round, or what is missing from their slot.
  const me = account ? circle.members[account] : null;
  const gap = me && circle.status === STATUS.OPEN ? requiredCollateral(circle, me.slot) - collateralOf(me) : null;
  const presets = presetAmounts({ contribution: circle.contribution, collateralGap: gap });
  const preset = presets.find((p) => p.key === presetKey) ?? presets[0];
  const yocto = preset.key === 'custom' ? nearToYocto(custom) : preset.yocto.toString();
  const usdEstimate = yocto ? usdOfNear(yocto, destination?.price) : null;
  const minimum = route ? KNOWN_MINIMUM_USD[route.key] : undefined;
  const belowKnownMinimum = minimum !== undefined && usdEstimate !== null && usdEstimate < minimum;

  // Remember choices on this device only.
  useEffect(() => { remember({ route: routeKey, recipient, refunds }); }, [routeKey, recipient, refunds]);

  // Does the payout account exist on NEAR mainnet?
  const recipientProblem = nearMainnetAccountProblem(recipient);
  useEffect(() => {
    setExists(null);
    if (recipientProblem) return undefined;
    let live = true;
    const timer = setTimeout(() => { mainnetAccountExists(recipient).then((ok) => { if (live) setExists(ok); }); }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [recipient, recipientProblem]);

  // Live preview: dry EXACT_OUTPUT quote, refreshed every PREVIEW_REFRESH_S seconds. Never commits.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (deposit) return undefined;
    const t = setInterval(() => setRefreshTick((n) => n + 1), PREVIEW_REFRESH_S * 1000);
    return () => clearInterval(t);
  }, [deposit]);
  useEffect(() => {
    if (!route || !destination || deposit) return undefined;
    if (!yocto || belowKnownMinimum) { setPreview({ state: 'idle' }); return undefined; }
    const id = ++requestId.current;
    setPreview((p) => ({ ...p, state: p.quote ? 'refreshing' : 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const data = await postQuote(exactOutputRequest({
          originAsset: route.token.assetId,
          destinationAsset: destination.assetId,
          yocto,
          recipient: recipientProblem ? PREVIEW_RECIPIENT : recipient,
          refundTo: refundAddressProblem(route.family, refundTo) ? PREVIEW_REFUND[route.family] : refundTo,
        }));
        if (id === requestId.current) setPreview({ state: 'ready', quote: data.quote, at: Date.now(), key: `${route.key}:${yocto}` });
      } catch (e) {
        if (id === requestId.current) setPreview((p) => ({ ...p, state: 'error', message: e.message }));
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [route?.key, destination?.assetId, yocto, belowKnownMinimum, deposit, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll the swap status once a deposit address exists.
  useEffect(() => {
    if (!deposit) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const r = await fetch(`/api/status?depositAddress=${encodeURIComponent(deposit.depositAddress)}${deposit.depositMemo ? `&depositMemo=${encodeURIComponent(deposit.depositMemo)}` : ''}`);
        if (r.ok) {
          const data = await r.json();
          if (!stopped) setStatus(data.status);
          if (TERMINAL.includes(data.status)) return;
        }
      } catch { /* keep polling */ }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [deposit]);

  const quoteMatches = preview.key === `${route?.key}:${yocto}`;
  const age = preview.at ? Math.floor((nowMs - preview.at) / 1000) : null;
  const fresh = preview.quote && quoteMatches && age !== null && age < PREVIEW_STALE_S;
  const breakdown = fresh ? quoteBreakdown(preview.quote, { originDecimals: route?.token.decimals }) : null;
  const quotedMinimum = preview.state === 'error' ? minimumFromError(preview.message) : null;

  // Why the button is grey, in plain words.
  const refundProblem = route ? refundAddressProblem(route.family, refundTo) : null;
  const problems = [
    !yocto && (preset.key === 'custom' ? 'Enter how much NEAR you need, for example 0.5.' : 'Pick an amount.'),
    belowKnownMinimum && `${route.label} ${route.where} has a $${minimum} minimum right now. Pick USDC on Base or SOL for smaller amounts.`,
    recipientProblem,
    !recipientProblem && exists === false && `${recipient} does not exist on NEAR mainnet yet. Check the spelling, or create it in your wallet first.`,
    refundProblem,
    yocto && !belowKnownMinimum && !fresh && preview.state !== 'error' && 'Waiting for a live quote…',
    preview.state === 'error' && 'There is no quote for this amount and route. See the message above.',
    !confirmed && 'Tick the box to confirm you are sending from your own wallet.',
  ].filter(Boolean);
  const canCommit = route && destination && problems.length === 0;

  async function commit() {
    if (!canCommit || committing) return;
    setCommitting(true);
    setError(null);
    try {
      // A fresh, binding quote at the moment of committing (dry: false).
      const data = await postQuote(exactOutputRequest({ dry: false, originAsset: route.token.assetId, destinationAsset: destination.assetId, yocto, recipient, refundTo }));
      if (!data.quote?.depositAddress) throw new Error('1Click did not return a deposit address');
      setDeposit({ ...data.quote, route });
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
  const depositLeft = deposit ? secondsLeft(deposit.deadline, nowMs) : null;
  const committed = deposit ? quoteBreakdown(deposit, { originDecimals: deposit.route.token.decimals }) : null;

  return (
    <Drawer title="Pay from any chain" onClose={onClose}>
      <NetLabel net="mainnet">Real money on NEAR mainnet, through NEAR Intents 1Click.</NetLabel>
      <NetLabel net="testnet">This circle is on testnet. The NEAR lands in <b>your NEAR mainnet account</b>. It does not pay this testnet round by itself.</NetLabel>

      {tokensError ? (
        <div className="stack">
          <p className="danger" role="alert">Live quotes are unavailable right now: {tokensError}.</p>
          <p className="helper">Nothing is simulated here. Quotes appear when the 1Click API answers.</p>
        </div>
      ) : null}
      {!tokens && !tokensError ? <div className="skeleton" style={{ height: '8rem' }} aria-label="Loading routes" /> : null}

      {tokens && route && !deposit ? (
        <>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: '0.5rem' }}>How much NEAR do you need?</legend>
            <div className="choice choice--3">
              {presets.map((p) => (
                <label key={p.key}>
                  <input type="radio" name="preset" checked={p.key === preset.key} onChange={() => setPresetKey(p.key)} />
                  <b>{p.label}</b>
                  <small>{p.yocto !== null ? `${near(p.yocto)} NEAR${destination ? ` · ≈ $${money(usdOfNear(p.yocto, destination.price))}` : ''}` : 'Type an amount'}</small>
                </label>
              ))}
            </div>
            {preset.key === 'custom' ? (
              <div className="field" style={{ marginTop: 'var(--s-3)' }}>
                <label className="field__label" htmlFor="pay-custom">Amount of NEAR</label>
                <input id="pay-custom" className="input" inputMode="decimal" placeholder="0.5" value={custom} onChange={(e) => setCustom(e.target.value)} />
              </div>
            ) : null}
          </fieldset>

          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: '0.5rem' }}>Pay with</legend>
            <div className="choice choice--3">
              {routes.map((r) => (
                <label key={r.key}>
                  <input type="radio" name="route" checked={r.key === route.key} onChange={() => setRouteKey(r.key)} />
                  <b>{r.label}</b><small>{r.where}{KNOWN_MINIMUM_USD[r.key] ? ` · min $${KNOWN_MINIMUM_USD[r.key]}` : ''}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="card card--dark card--flat" aria-live="polite" style={{ background: 'var(--black)' }}>
            {belowKnownMinimum ? (
              <p className="helper" role="alert">{route.label} {route.where} has a ${minimum} minimum right now, and this payment is about ${money(usdEstimate)}. Pick USDC on Base or SOL instead.</p>
            ) : null}
            {!belowKnownMinimum && preview.state === 'error' ? (
              <div className="stack stack--sm" role="alert">
                <p className="danger">No quote: {preview.message}</p>
                {quotedMinimum ? <p className="helper">1Click has a ${quotedMinimum} minimum on this route right now. Pick USDC on Base or SOL for smaller payments.</p> : null}
              </div>
            ) : null}
            {!belowKnownMinimum && !breakdown && preview.state !== 'error' && yocto ? <div className="skeleton" style={{ height: '6rem', background: 'var(--ink-2)' }} aria-label="Getting a live quote" /> : null}
            {breakdown ? (
              <div className="stack stack--sm">
                <p className="label">Live quote · {preview.state === 'refreshing' ? 'refreshing…' : `refreshes in ${Math.max(0, PREVIEW_REFRESH_S - age)}s`}</p>
                <p><span className="numeral mint">{amount(breakdown.receive)}</span> <span className="stat__unit">NEAR lands in your NEAR mainnet account</span></p>
                <dl className="facts facts--quote">
                  <div><dt>You send</dt><dd>{amount(breakdown.send)} {route.label} {route.where} · ${money(breakdown.sendUsd)}</dd></div>
                  <div><dt>Least 1Click accepts</dt><dd>{amount(breakdown.minimumAccepted)} {route.label}</dd></div>
                  <div><dt>You receive</dt><dd>exactly {amount(breakdown.receive)} NEAR · ${money(breakdown.receiveUsd)}</dd></div>
                  <div><dt>Fees and price spread</dt><dd>≈ ${money(breakdown.costUsd)}</dd></div>
                  <div><dt>Time</dt><dd>about {breakdown.seconds ?? '?'}s after your deposit confirms</dd></div>
                  <div><dt>If it is refunded</dt><dd>{breakdown.refundFee !== null ? `${amount(breakdown.refundFee)} ${route.label} refund fee` : 'a small refund fee'}</dd></div>
                </dl>
                <p className="helper">"You send" includes a 1% safety margin. Anything 1Click does not need comes back to your refund address.</p>
              </div>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-recipient">Your NEAR mainnet account</label>
            <input id="pay-recipient" className="input mono" style={{ fontSize: '1rem' }} placeholder="yourname.near" autoCapitalize="none" spellCheck={false} value={recipient} onChange={(e) => setRecipient(e.target.value.trim().toLowerCase())} aria-describedby="pay-recipient-hint" />
            <span className="field__hint" id="pay-recipient-hint">
              {recipient && recipientProblem ? <span className="danger">{recipientProblem}</span>
                : exists === true ? '✓ Found on NEAR mainnet.'
                  : exists === false ? <span className="danger">Not found on NEAR mainnet.</span>
                    : 'Where the NEAR lands. Mainnet accounts end in .near.'}
            </span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pay-refund">Refund address {route.where}</label>
            <input id="pay-refund" className="input mono" style={{ fontSize: '1rem' }} placeholder={REFUND_PLACEHOLDER[route.family]} autoCapitalize="none" spellCheck={false} value={refundTo} onChange={(e) => setRefunds({ ...refunds, [route.family]: e.target.value.trim() })} aria-describedby="pay-refund-hint" />
            <span className="field__hint" id="pay-refund-hint">{refundTo && refundProblem ? <span className="danger">{refundProblem}</span> : 'The address you pay from. If the swap cannot finish, 1Click sends the money back here.'}</span>
          </div>

          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I am sending real money from a wallet I control, <b>not from an exchange</b>.</span>
          </label>

          {error ? <p className="danger" role="alert">{error}</p> : null}
          <Cta size="lg" busy={committing} disabled={!canCommit || undefined} onClick={commit}>Get deposit address</Cta>
          {problems.length && !committing ? (
            <ul className="reasons" aria-label="Before you can continue">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : (
            <p className="helper">This asks 1Click for a fresh, binding quote. Nothing moves until you send money to the address it gives you.</p>
          )}
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
          <p className="subtitle" style={{ color: '#e6e6e6' }}>Send {amount(committed.send)} {deposit.route.label} {deposit.route.where} (at least {amount(committed.minimumAccepted)}) to:</p>
          {qr ? <div className="qr"><img src={qr} alt={`QR code of the deposit address ${deposit.depositAddress}`} /></div> : null}
          <div className="copy">
            <code>{deposit.depositAddress}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(deposit.depositAddress)}>Copy</button>
          </div>
          {deposit.depositMemo ? <p className="danger">Memo required: {deposit.depositMemo}</p> : null}
          {depositLeft !== null ? (
            <p className={depositLeft > 120 ? 'label' : 'danger'} aria-live="off">
              {depositLeft > 0 ? `Send within ${Math.floor(depositLeft / 60)}:${String(depositLeft % 60).padStart(2, '0')}` : 'This address has expired. Do not send to it: start over for a new one.'}
            </p>
          ) : null}
          <p className="helper">{amount(committed.receive)} NEAR lands in {recipient} on NEAR mainnet. If the swap cannot finish, the money goes back to {refundTo.slice(0, 8)}…</p>
          <Cta variant="ghost" size="sm" onClick={() => { setDeposit(null); setStatus(null); setQr(''); setConfirmed(false); }}>Start over</Cta>
        </>
      ) : null}
    </Drawer>
  );
}
