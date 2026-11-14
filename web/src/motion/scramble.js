/** Techno "decode" effect: characters cycle through glyphs and settle left to right. */
import { reducedMotion, tween } from './raf.js';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#/+<>';

/**
 * @param {HTMLElement} el      element whose textContent is animated
 * @param {string} text         the final text
 * @param {{duration?: number, delay?: number}} [options]
 * @returns {() => void} cancel
 */
export function scramble(el, text, { duration = 900, delay = 0 } = {}) {
  if (reducedMotion()) {
    el.textContent = text;
    return () => {};
  }
  const chars = [...text];
  let lastSwap = 0;
  let noise = chars.map(() => '');
  return tween({
    duration,
    delay,
    ease: (t) => t,
    onUpdate: (t) => {
      const now = performance.now();
      if (now - lastSwap > 45) {
        lastSwap = now;
        noise = chars.map(() => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]);
      }
      const settled = Math.floor(t * chars.length);
      let out = '';
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        out += i < settled || c === ' ' || c === '\n' ? c : noise[i];
      }
      el.textContent = out;
    },
    onDone: () => { el.textContent = text; },
  });
}
