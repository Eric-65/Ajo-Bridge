/**
 * IntersectionObserver fallback for the scroll-driven reveals in motion.css, and
 * the trigger for JS-driven entrances (text scramble, count-up).
 */

const supportsScrollTimeline = () => typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()');

/** Call `fn` once when `el` first enters the viewport. Returns a cleanup function. */
export function onceInView(el, fn, { threshold = 0.25 } = {}) {
  if (!el) return () => {};
  if (typeof IntersectionObserver === 'undefined') {
    fn();
    return () => {};
  }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { threshold });
  io.observe(el);
  return () => io.disconnect();
}

/** Mark every .reveal / .reveal-wipe under `root` as in view when CSS scroll timelines are missing. */
export function installRevealFallback(root = document) {
  if (supportsScrollTimeline()) return () => {};
  const cleanups = [...root.querySelectorAll('.reveal:not(.is-inview), .reveal-wipe:not(.is-inview)')]
    .map((el) => onceInView(el, () => el.classList.add('is-inview'), { threshold: 0.15 }));
  return () => cleanups.forEach((stop) => stop());
}
