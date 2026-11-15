/** Small presentational building blocks shared by every page. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { magnetic } from '../motion/effects.js';
import { easeOutExpo, tween } from '../motion/raf.js';
import { onceInView } from '../motion/reveal.js';
import { scramble } from '../motion/scramble.js';

/** Mint CTA bar with chevron and cut corner. Renders a link when `to`/`href` is given. */
export function Cta({ children, to, href, size, variant, done, busy, note, pull = false, className = '', ...rest }) {
  const ref = useRef(null);
  useEffect(() => (pull && ref.current ? magnetic(ref.current, 0.12) : undefined), [pull]);
  const classes = ['cta', size && `cta--${size}`, variant && `cta--${variant}`, done && 'cta--done', className].filter(Boolean).join(' ');
  const content = (
    <>
      <span>{children}</span>
      {note ? <span className="cta__note">{note}</span> : null}
    </>
  );
  if (to) return <Link ref={ref} className={classes} to={to} viewTransition {...rest}>{content}</Link>;
  if (href) return <a ref={ref} className={classes} href={href} {...rest}>{content}</a>;
  return (
    <button ref={ref} type="button" className={classes} data-busy={busy ? 'true' : undefined} aria-disabled={done || undefined} {...rest}>
      {content}
    </button>
  );
}

export const Eyebrow = ({ children, plain }) => <p className={`eyebrow${plain ? ' eyebrow--plain' : ''}`}>{children}</p>;

/**
 * One highlighted word: a dark block that wipes in from the left, then a mint
 * word that decodes out of random glyphs. The real text stays in the DOM for
 * screen readers and search; the scrambling happens in a separate aria-hidden
 * layer that React never renders into, so text updates stay safe.
 */
export function Hl({ children, i = 0, tone }) {
  const text = String(children);
  const ref = useRef(null);
  const fx = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.classList.remove('is-on', 'is-done');
    let cancel = () => {};
    const stop = onceInView(el, () => {
      el.classList.add('is-on');
      cancel = scramble(fx.current, text, {
        delay: 260 + i * 140,
        duration: Math.min(900, 360 + text.length * 50),
        onDone: () => el.classList.add('is-done'),
      });
    }, { threshold: 0.35 });
    return () => { stop(); cancel(); };
  }, [text, i]);
  return (
    <span ref={ref} className="hl" data-tone={tone} style={{ '--i': i }}>
      <span className="hl__real">{text}</span>
      <span ref={fx} className="hl__fx" aria-hidden="true" />
    </span>
  );
}

/**
 * Big uppercase heading where some words sit in mint-on-dark blocks.
 * `parts` is a list of strings; wrap a string in [brackets] to highlight it.
 * Each highlighted word becomes its own block, staggered left to right.
 */
export function HighlightHeading({ parts, as: Tag = 'h2', className = 'display' }) {
  let n = 0;
  return (
    <Tag className={`${className} hl-heading`}>
      {parts.map((part, i) => {
        const match = /^\[(.+)\]$/.exec(part);
        if (!match) return <span key={i}>{part} </span>;
        return (
          <span key={i}>
            {match[1].split(/\s+/).map((word, j) => <span key={j}><Hl i={n++}>{word}</Hl>{' '}</span>)}
          </span>
        );
      })}
    </Tag>
  );
}

/** Heading that decodes itself when it scrolls into view. Screen readers get the final text. */
export function Scramble({ text, as: Tag = 'h2', className = 'display', delay = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    let cancel = () => {};
    const stop = onceInView(el, () => { cancel = scramble(el, text, { delay, duration: Math.min(1400, 500 + text.length * 22) }); });
    return () => { stop(); cancel(); el.textContent = text; };
  }, [text, delay]);
  return (
    <Tag className={className} aria-label={text}>
      <span ref={ref} aria-hidden="true">{text}</span>
    </Tag>
  );
}

/** Number that counts up (or down) to `value` with easing whenever it changes. */
export function CountUp({ value, format = (n) => n.toFixed(0), duration = 1100, className }) {
  const ref = useRef(null);
  const shown = useRef(0);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    const run = () => {
      started.current = true;
      const from = shown.current;
      return tween({
        duration,
        ease: easeOutExpo,
        onUpdate: (t) => {
          shown.current = from + (value - from) * t;
          el.textContent = format(shown.current);
        },
      });
    };
    if (started.current) return run();
    let cancel = () => {};
    const stop = onceInView(el, () => { cancel = run(); }, { threshold: 0.1 });
    return () => { stop(); cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span ref={ref} className={className} aria-label={format(value)}>{format(0)}</span>;
}

/** Circle rounds as segments: past = grey, current = pulsing mint, upcoming = pale mint. */
export function SegmentBar({ total, current, done = false, label, danger = false }) {
  return (
    <div
      className={`segments${danger ? ' segments--danger' : ''}`}
      data-animate="true"
      role="progressbar"
      aria-label={label ?? 'Rounds'}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done ? total : Math.max(0, current - 1)}
      aria-valuetext={done ? 'All rounds complete' : current > 0 ? `Round ${current} of ${total}` : 'Not started'}
    >
      {Array.from({ length: total }, (_, i) => {
        const round = i + 1;
        const state = done || round < current ? 'done' : round === current ? 'current' : 'next';
        return <span key={i} className="segments__seg" data-state={state} style={{ '--i': i }} />;
      })}
    </div>
  );
}

export function Stat({ label, value, unit, note, danger, format, children }) {
  return (
    <div className={`stat${danger ? ' stat--danger' : ''}`}>
      <span className="stat__label">{label}</span>
      <div className="stat__value">
        {children ?? <CountUp className="numeral" value={value} format={format} />}
        {unit ? <span className="stat__unit">{unit}</span> : null}
      </div>
      <span className="stat__bar" />
      {note ? <p className="stat__note">{note}</p> : null}
    </div>
  );
}

export function Meter({ total, filled, late = 0 }) {
  return (
    <span className="meter" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => <i key={i} data-on={i < filled ? 'true' : i < filled + late ? 'late' : 'false'} />)}
    </span>
  );
}

/** Numbered accordion. Closed rows are light, the open row turns dark with a mint number. */
export function Accordion({ items, initial = 0 }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="acc">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <section key={item.title} className="acc__item" data-open={isOpen}>
            <h3>
              <button type="button" className="acc__head" aria-expanded={isOpen} aria-controls={`acc-${i}`} onClick={() => setOpen(isOpen ? -1 : i)}>
                <span className="acc__num">{String(i + 1).padStart(2, '0')}</span>
                <span className="acc__title">{item.title}</span>
                <svg className="acc__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M3 8l9 8 9-8" /></svg>
              </button>
            </h3>
            <p className="acc__sum">{item.summary}</p>
            <div className="acc__panel" id={`acc-${i}`} role="region" aria-label={item.title} inert={!isOpen}>
              <div><div className="acc__inner">{item.body}</div></div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Bottom sheet on phones, side panel on desktop. Closes on Escape and scrim click. */
export function Drawer({ title, onClose, children, labelledBy = 'drawer-title' }) {
  const ref = useRef(null);
  // Parents often pass a new onClose on every render (pages re-render each second for
  // countdowns). Keep the latest one in a ref so the mount effect below runs once:
  // re-running it would steal focus from inputs and close the phone keyboard mid-edit.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        <header className="drawer__head">
          <h2 id={labelledBy} className="title">{title}</h2>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer__body">{children}</div>
      </aside>
    </>
  );
}

/** Which network a piece of UI is talking to. Shown wherever money is quoted or moved. */
export function NetLabel({ net, children }) {
  return (
    <p className="netlabel">
      <b data-net={net}>{net}</b>
      <span>{children}</span>
    </p>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? '3rem' : '1.4rem', width: `${100 - i * 14}%` }} />)}
    </div>
  );
}
