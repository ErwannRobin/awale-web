import { useEffect, useState } from 'react';
import type { Orientation } from './layout.ts';

// Below this width the board is rotated a quarter-turn so six pits still fit.
export const PORTRAIT_MAX_WIDTH = 620;

const query = `(max-width: ${PORTRAIT_MAX_WIDTH}px)`;

function current(): Orientation {
  if (typeof window === 'undefined' || !window.matchMedia) return 'landscape';
  return window.matchMedia(query).matches ? 'portrait' : 'landscape';
}

/**
 * The one browser-specific piece of the board layout.
 *
 * PORTING NOTE: React Native has no media queries — replace the body with
 * `const { width } = useWindowDimensions();` and return
 * `width <= PORTRAIT_MAX_WIDTH ? 'portrait' : 'landscape'`. Everything the
 * layout does with the answer lives in `lib/layout.ts` and is already portable.
 */
export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(current);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setOrientation(mq.matches ? 'portrait' : 'landscape');
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return orientation;
}
