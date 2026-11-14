import { useEffect, useRef } from 'react';

import { halftone } from '../motion/halftone.js';

/** Animated black-and-white halftone field used where the template has photography. */
export function HalftoneArt({ variant = 'wave' }) {
  const ref = useRef(null);
  useEffect(() => halftone(ref.current, variant), [variant]);
  return <canvas ref={ref} aria-hidden="true" />;
}

/**
 * Black-and-white photograph (pre-processed in web/public/img: grayscale, crushed
 * blacks, vignette, light grain). Decorative, so screen readers skip it.
 * Photos: Pixabay, Pixabay Content License. Credits in the README.
 */
export function Photo({ name, position = '50% 50%', priority = false }) {
  return (
    <img
      src={`/img/${name}-800.webp`}
      srcSet={`/img/${name}-800.webp 800w, /img/${name}-1600.webp 1600w`}
      sizes="(min-width: 56rem) 50vw, 100vw"
      alt=""
      aria-hidden="true"
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      style={{ objectPosition: position }}
    />
  );
}

/** Page header over a full-bleed photo: eyebrow, title, subtitle, like the template's case-study panels. */
export function PhotoHead({ photo, position, children }) {
  return (
    <section className="photo-head">
      <div className="photo-head__art"><Photo name={photo} position={position} priority /></div>
      <div className="wrap photo-head__copy stack">{children}</div>
    </section>
  );
}
