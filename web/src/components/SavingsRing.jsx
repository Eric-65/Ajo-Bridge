/**
 * The savings ring: members around a circle, the pot in the middle.
 *
 * Drawn in white and grey lines on black; mint is reserved for money moving.
 * Coins travel along the SVG spokes with getPointAtLength inside one shared
 * requestAnimationFrame loop (no animation library).
 *
 *   autoplay   loops a whole round for the landing hero
 *   effects    { id, events } from the last contract call: plays the matching
 *              coins for contributions, slashes and payouts on the dashboard
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { burst, glitch } from '../motion/effects.js';
import { easeInOutCubic, onFrame, reducedMotion, tween } from '../motion/raf.js';

const SIZE = 400;
const C = SIZE / 2;
const ORBIT = 148;
const NODE = 21;
const POT = 54;
const COINS = 28;

function geometry(count) {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    const x = C + Math.cos(angle) * ORBIT;
    const y = C + Math.sin(angle) * ORBIT;
    // start on the node's edge, end on the pot's edge, bow sideways for a sweeping arc
    const sx = C + Math.cos(angle) * (ORBIT - NODE);
    const sy = C + Math.sin(angle) * (ORBIT - NODE);
    const ex = C + Math.cos(angle + 0.5) * POT;
    const ey = C + Math.sin(angle + 0.5) * POT;
    const mid = (ORBIT + POT) / 2;
    const cx = C + Math.cos(angle + 0.42) * mid;
    const cy = C + Math.sin(angle + 0.42) * mid;
    const lx = C + Math.cos(angle) * (ORBIT + NODE + 15);
    const ly = C + Math.sin(angle) * (ORBIT + NODE + 15) + 4;
    return { x, y, lx, ly, d: `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}` };
  });
}

/**
 * @param {object} props
 * @param {Array<{label: string, name?: string, state: 'paid'|'due'|'late'|'recipient'|'empty'}>} props.members
 * @param {string} [props.centerLabel]
 * @param {string} [props.centerValue]
 * @param {number} [props.fill]        0..1 how full the pot is
 * @param {boolean} [props.autoplay]
 * @param {{id: number, events: Array}} [props.effects]
 * @param {string[]} [props.accounts]  account id per slot, to map events to nodes
 * @param {string} props.ariaLabel
 */
export function SavingsRing({ members, centerLabel = 'Pot', centerValue, fill = 0, autoplay = false, effects, accounts = [], ariaLabel, ref }) {
  const count = members.length;
  const points = useMemo(() => geometry(count), [count]);
  const svgRef = useRef(null);
  const pathRefs = useRef([]);
  const nodeRefs = useRef([]);
  const coinRefs = useRef([]);
  const potFillRef = useRef(null);
  const potRef = useRef(null);
  const flights = useRef([]);
  const potLevel = useRef(fill);
  const [demoRecipient, setDemoRecipient] = useState(0);
  const [demoPaid, setDemoPaid] = useState(() => new Set());

  // --- flight engine --------------------------------------------------------
  function launch(index, { reverse = false, duration = 900, delay = 0, red = false, onDone } = {}) {
    const path = pathRefs.current[index];
    const coin = coinRefs.current.find((c) => c && !c.dataset.busy);
    if (!path || !coin) { onDone?.(); return; }
    coin.dataset.busy = '1';
    coin.classList.toggle('ring__coin--red', red);
    flights.current.push({ coin, path, length: path.getTotalLength(), start: performance.now() + delay, duration, reverse, onDone });
  }

  function setPot(level, animate = true) {
    const el = potFillRef.current;
    if (!el) return;
    const from = potLevel.current;
    potLevel.current = level;
    if (!animate) { el.style.transform = `scale(${Math.sqrt(level)})`; return; }
    tween({ duration: 420, onUpdate: (t) => { el.style.transform = `scale(${Math.sqrt(from + (level - from) * t)})`; } });
  }

  useEffect(() => {
    const stop = onFrame((now) => {
      if (!flights.current.length) return;
      flights.current = flights.current.filter((f) => {
        const raw = (now - f.start) / f.duration;
        if (raw < 0) return true;
        const t = Math.min(1, raw);
        const eased = easeInOutCubic(t);
        const p = f.path.getPointAtLength(f.length * (f.reverse ? 1 - eased : eased));
        f.coin.style.transform = `translate(${p.x}px, ${p.y}px)`;
        f.coin.style.opacity = t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1;
        if (t < 1) return true;
        f.coin.style.opacity = 0;
        delete f.coin.dataset.busy;
        f.onDone?.();
        return false;
      });
    });
    return stop;
  }, []);

  useEffect(() => { if (!autoplay) setPot(fill); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fill, autoplay]);

  // --- hero loop: everyone pays in, the pot flows to the recipient, repeat ---
  useEffect(() => {
    if (!autoplay) return undefined;
    if (reducedMotion()) { setPot(0.7, false); setDemoPaid(new Set(points.map((_, i) => i))); return undefined; }
    let alive = true;
    let recipient = 0;
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));

    const cycle = () => {
      setDemoRecipient(recipient);
      setDemoPaid(new Set());
      setPot(0, false);
      let arrived = 0;
      points.forEach((_, i) => {
        launch(i, {
          delay: 250 + i * 170,
          duration: 950,
          onDone: () => {
            arrived += 1;
            setDemoPaid((prev) => new Set(prev).add(i));
            setPot(arrived / count);
          },
        });
      });
      const filled = 250 + count * 170 + 950;
      later(() => {
        const stream = 7;
        for (let k = 0; k < stream; k++) {
          launch(recipient, {
            reverse: true,
            delay: k * 95,
            duration: 760,
            onDone: k === stream - 1 ? () => { if (alive) burst(nodeRefs.current[recipient], { count: 18 }); } : undefined,
          });
        }
        setPot(0);
      }, filled + 500);
      later(() => { recipient = (recipient + 1) % count; cycle(); }, filled + 500 + 7 * 95 + 760 + 1300);
    };
    cycle();
    return () => { alive = false; timers.forEach(clearTimeout); flights.current = []; coinRefs.current.forEach((c) => { if (c) { c.style.opacity = 0; delete c.dataset.busy; } }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, count]);

  // --- dashboard: replay what the last transaction did -----------------------
  useEffect(() => {
    if (autoplay || !effects?.events?.length) return;
    const slotOf = (account) => accounts.indexOf(account);
    let delay = 0;
    for (const { event, data } of effects.events) {
      const i = slotOf(data.account);
      if (event === 'contributed' && i >= 0) { launch(i, { delay }); delay += 160; }
      if ((event === 'member_slashed' || event === 'voucher_slashed') && i >= 0) {
        setTimeout(() => glitch(svgRef.current), delay);
        launch(i, { delay: delay + 120, red: true, duration: 1100 });
        delay += 380;
      }
      if (event === 'round_paid' && i >= 0) {
        for (let k = 0; k < 7; k++) {
          launch(i, { reverse: true, delay: delay + 500 + k * 95, duration: 760, onDone: k === 6 ? () => burst(nodeRefs.current[i]) : undefined });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effects?.id]);

  useImperativeHandle(ref, () => ({ node: (i) => nodeRefs.current[i], pot: () => potRef.current }), []);

  const view = autoplay
    ? members.map((m, i) => ({ ...m, state: i === demoRecipient ? 'recipient' : demoPaid.has(i) ? 'paid' : 'due' }))
    : members;

  return (
    <div className="ring">
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel}>
        <circle className="ring__orbit" cx={C} cy={C} r={ORBIT} />
        <circle className="ring__orbit ring__orbit--dash" cx={C} cy={C} r={ORBIT + NODE + 34} />
        <circle className="ring__orbit ring__orbit--dash" cx={C} cy={C} r={(ORBIT + POT) / 2} />
        {points.map((p, i) => (
          <path key={`s${i}`} ref={(el) => { pathRefs.current[i] = el; }} className="ring__spoke" data-state={view[i].state} d={p.d} />
        ))}
        <circle ref={potRef} className="ring__pot" cx={C} cy={C} r={POT} />
        <circle ref={potFillRef} className="ring__pot-fill" cx={C} cy={C} r={POT - 5} style={{ transform: `scale(${Math.sqrt(potLevel.current)})` }} />
        {points.map((p, i) => {
          const m = view[i];
          return (
            <g key={`n${i}`} aria-hidden="true">
              {m.state === 'recipient' ? <circle className="ring__halo" cx={p.x} cy={p.y} r={NODE} /> : null}
              <circle ref={(el) => { nodeRefs.current[i] = el; }} className="ring__node" data-state={m.state} cx={p.x} cy={p.y} r={NODE} />
              <text className="ring__initial" data-state={m.state} x={p.x} y={p.y + 1}>{m.label}</text>
              {m.name ? <text className="ring__name" data-state={m.state} x={p.lx} y={p.ly}>{m.name}</text> : null}
            </g>
          );
        })}
        {Array.from({ length: COINS }, (_, i) => (
          <circle key={`c${i}`} ref={(el) => { coinRefs.current[i] = el; }} className="ring__coin" r="5.5" cx="0" cy="0" />
        ))}
      </svg>
      <div className="ring__center" aria-hidden="true">
        <span className="ring__center-label">{centerLabel}</span>
        {centerValue ? <span className="ring__center-value">{centerValue}</span> : null}
      </div>
    </div>
  );
}
