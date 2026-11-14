/** One-shot effects built on the Web Animations API: particle burst, slash glitch, flying chips. */
import { reducedMotion } from './raf.js';

const centre = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Mint particle burst from the centre of `origin` (payout celebration). */
export function burst(origin, { count = 26, colour = 'var(--mint)' } = {}) {
  if (reducedMotion() || !origin) return;
  const { x, y } = centre(origin);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'particle';
    p.style.background = colour;
    p.style.left = `${x - 4}px`;
    p.style.top = `${y - 4}px`;
    document.body.append(p);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 60 + Math.random() * 120;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    p.animate(
      [
        { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy + 40}px) scale(0.2) rotate(${180 + Math.random() * 180}deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
    ).finished.then(() => p.remove());
  }
}

/** Short red flash plus a horizontal jitter on `target` (a slash just happened). */
export function glitch(target) {
  if (reducedMotion()) return;
  const flash = document.createElement('i');
  flash.className = 'glitch-flash';
  document.body.append(flash);
  flash.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0.1 }, { opacity: 0.4 }, { opacity: 0 }], { duration: 380, easing: 'steps(5, end)' })
    .finished.then(() => flash.remove());
  target?.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-7px) skewX(-4deg)' },
      { transform: 'translateX(6px) skewX(3deg)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 320, easing: 'steps(4, end)' },
  );
}

/** A collateral chip slides from the slashed member to the member who was owed. */
export function flyChip(from, to, label) {
  if (reducedMotion() || !from || !to) return;
  const a = centre(from);
  const b = centre(to);
  const chip = document.createElement('span');
  chip.className = 'chip-fly';
  chip.textContent = label;
  chip.style.left = `${a.x}px`;
  chip.style.top = `${a.y}px`;
  document.body.append(chip);
  chip.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.15 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(1)`, opacity: 1, offset: 0.85 },
      { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(0.5)`, opacity: 0 },
    ],
    { duration: 950, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
  ).finished.then(() => chip.remove());
}

/** Desktop-only magnetic pull: the element leans towards the pointer. Returns a cleanup function. */
export function magnetic(el, strength = 0.22) {
  if (reducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  const move = (event) => {
    const r = el.getBoundingClientRect();
    const dx = (event.clientX - (r.left + r.width / 2)) * strength;
    const dy = (event.clientY - (r.top + r.height / 2)) * strength;
    el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  };
  const leave = () => {
    el.animate([{ transform: el.style.transform || 'none' }, { transform: 'translate(0, 0)' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    el.style.transform = '';
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  return () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave);
  };
}
