import { useEffect, useRef } from 'react';

import { halftone } from '../motion/halftone.js';

/** Animated black-and-white halftone field used where the template has photography. */
export function HalftoneArt({ variant = 'wave' }) {
  const ref = useRef(null);
  useEffect(() => halftone(ref.current, variant), [variant]);
  return <canvas ref={ref} aria-hidden="true" />;
}
