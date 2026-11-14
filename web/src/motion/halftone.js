/**
 * Black-and-white halftone dot field drawn on a canvas: our stand-in for the
 * template's B&W photography (no stock photos are bundled). The dots ride a few
 * layered sine waves; `variant` changes the composition.
 */
import { onFrame, reducedMotion } from './raf.js';

const VARIANTS = {
  wave: { rows: 46, tilt: 0.55, amp: 0.2, speed: 0.00022, focus: 0.62 },
  dunes: { rows: 38, tilt: 0.42, amp: 0.3, speed: 0.00016, focus: 0.45 },
  rain: { rows: 54, tilt: 0.75, amp: 0.12, speed: 0.0003, focus: 0.7 },
};

export function halftone(canvas, variant = 'wave') {
  const cfg = VARIANTS[variant] ?? VARIANTS.wave;
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let visible = true;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = (time) => {
    ctx.clearRect(0, 0, width, height);
    const rows = width < 640 ? Math.round(cfg.rows * 0.7) : cfg.rows;
    const cols = Math.round(rows * Math.max(0.7, width / Math.max(1, height)));
    for (let r = 0; r < rows; r++) {
      const depth = r / (rows - 1); // 0 = far, 1 = near
      const y0 = height * (0.18 + depth ** 1.6 * 0.82);
      const spread = 0.55 + depth * 0.75;
      const blur = Math.abs(depth - cfg.focus);
      for (let c = 0; c <= cols; c++) {
        const u = c / cols - 0.5;
        const phase = u * 7 + depth * 5;
        const lift = Math.sin(phase + time * cfg.speed * 6) * 0.6 + Math.sin(phase * 0.43 - time * cfg.speed * 4 + depth * 9) * 0.4;
        const x = width * (0.5 + u * spread * 1.5 + depth * cfg.tilt * 0.08);
        const y = y0 - lift * height * cfg.amp * (0.25 + depth * 0.75);
        const radius = (0.5 + depth * 2.6) * (1 + blur * 2.2) * (0.75 + (lift + 1) * 0.25);
        const alpha = (0.22 + (lift + 1) * 0.36) * (1 - blur * 0.85) * (0.35 + depth * 0.65);
        if (alpha <= 0.02 || x < -8 || x > width + 8) continue;
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  resize();
  draw(0);
  const ro = new ResizeObserver(() => { resize(); draw(performance.now()); });
  ro.observe(canvas);
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  io.observe(canvas);
  // 30 fps is plenty for a slow background and halves the cost on mid-range phones.
  let lastDraw = 0;
  const stop = reducedMotion() ? () => {} : onFrame((now) => {
    if (!visible || document.hidden || now - lastDraw < 33) return;
    lastDraw = now;
    draw(now);
  });
  return () => { stop(); ro.disconnect(); io.disconnect(); };
}
