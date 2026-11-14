import { useEffect, useRef } from 'react';

import { near } from '../lib/format.js';
import { tween } from '../motion/raf.js';

/**
 * Collateral per slot as horizontal bars (dark = lock S_k, mint underline = order fee F_k).
 * Bars tween with requestAnimationFrame whenever the terms change.
 */
export function CollateralBars({ table }) {
  const fills = useRef([]);
  const fees = useRef([]);
  const shown = useRef({ fill: [], fee: [] });
  const maxLock = table.reduce((max, q) => (q.collateral > max ? q.collateral : max), 1n);
  const maxFee = table.reduce((max, q) => (q.fee > max ? q.fee : max), 1n);
  const key = table.map((q) => `${q.collateral}:${q.fee}`).join('|');

  useEffect(() => {
    const target = {
      fill: table.map((q) => Number((q.collateral * 1000n) / maxLock) / 1000),
      fee: table.map((q) => Number((q.fee * 1000n) / maxFee) / 1000),
    };
    const from = { fill: [...shown.current.fill], fee: [...shown.current.fee] };
    return tween({
      duration: 650,
      onUpdate: (t) => {
        target.fill.forEach((to, i) => {
          const a = from.fill[i] ?? 0;
          const b = from.fee[i] ?? 0;
          shown.current.fill[i] = a + (to - a) * t;
          shown.current.fee[i] = b + (target.fee[i] - b) * t;
          if (fills.current[i]) fills.current[i].style.transform = `scaleX(${shown.current.fill[i]})`;
          if (fees.current[i]) fees.current[i].style.transform = `scaleX(${shown.current.fee[i]})`;
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="stack">
      <div className="bars" role="table" aria-label="Collateral and order fee per payout slot">
        {table.map((q, i) => (
          <div className="bars__row" role="row" key={q.slot}>
            <span className="bars__slot" role="rowheader">Slot {q.slot}</span>
            <div className="bars__track" aria-hidden="true">
              <span className="bars__fill" ref={(el) => { fills.current[i] = el; }} style={{ transform: 'scaleX(0)' }} />
              <span className="bars__fee" ref={(el) => { fees.current[i] = el; }} style={{ transform: 'scaleX(0)' }} />
            </div>
            <span className="bars__value" role="cell" aria-label={`lock ${near(q.collateral)} NEAR, order fee ${near(q.fee)} NEAR`}>{near(q.collateral)}</span>
          </div>
        ))}
      </div>
      <p className="bars__legend"><span><i />Collateral to lock (NEAR)</span><span><i data-k="fee" />Order fee paid</span></p>
    </div>
  );
}
