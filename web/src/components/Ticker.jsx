import { useEffect, useRef } from 'react';

import { describeEvent, near } from '../lib/format.js';
import { onFrame, reducedMotion } from '../motion/raf.js';

/** Live marquee of circle activity. Pauses on hover and focus; static under reduced motion. */
export function Ticker({ entries }) {
  const trackRef = useRef(null);
  const paused = useRef(false);
  useEffect(() => {
    const track = trackRef.current;
    if (!track || reducedMotion()) return undefined;
    let x = 0;
    return onFrame((_, dt) => {
      if (paused.current) return;
      const half = track.scrollWidth / 2;
      if (half <= 0) return;
      x = (x + dt * 0.045) % half;
      track.style.transform = `translate3d(${-x}px, 0, 0)`;
    });
  }, [entries.length]);

  if (!entries.length) return null;
  const items = entries.map(describeEvent);
  const row = (hidden) => items.map((item, i) => (
    <span key={`${hidden}-${i}`} className="ticker__item" data-kind={item.kind} aria-hidden={hidden || undefined}>
      {item.who} · {item.text}{item.amount && item.amount !== '0' ? ` · ${near(item.amount)} NEAR` : ''}
    </span>
  ));
  return (
    <div
      className="ticker"
      role="marquee"
      aria-label="Recent circle activity"
      onPointerEnter={() => { paused.current = true; }}
      onPointerLeave={() => { paused.current = false; }}
    >
      <div ref={trackRef} className="ticker__track">{row(false)}{row(true)}</div>
    </div>
  );
}
