/** Shared animation primitives: one rAF loop, tweens and easings. No libraries. */

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutExpo = (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));
export const clamp01 = (t) => Math.min(1, Math.max(0, t));

const subscribers = new Set();
let frame = 0;
let last = 0;

function tick(now) {
  const dt = Math.min(64, now - last);
  last = now;
  for (const fn of subscribers) fn(now, dt);
  frame = subscribers.size ? requestAnimationFrame(tick) : 0;
}

/** Run `fn(now, dt)` every frame until the returned function is called. Pauses with the tab. */
export function onFrame(fn) {
  subscribers.add(fn);
  if (!frame) {
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
  return () => subscribers.delete(fn);
}

/**
 * Tween 0 → 1 over `duration` ms. Under reduced motion it jumps straight to the end.
 * @returns {() => void} cancel
 */
export function tween({ duration = 600, delay = 0, ease = easeOutCubic, onUpdate, onDone }) {
  if (reducedMotion() || duration <= 0) {
    onUpdate?.(1);
    onDone?.();
    return () => {};
  }
  const start = performance.now() + delay;
  const stop = onFrame((now) => {
    if (now < start) return;
    const t = clamp01((now - start) / duration);
    onUpdate?.(ease(t), t);
    if (t >= 1) {
      stop();
      onDone?.();
    }
  });
  return stop;
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
