import { useEffect, useState } from 'react';
import type { CanvasColours } from './types';

/**
 * The colours Konva needs as real values: the theme's, read from <html> as the location map and the sketch editor read
 * theirs. The fallbacks are system colour keywords, not brand values; the theme's tokens are always there in the app.
 */
export function themeColours(): CanvasColours {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { ink: read('--text', 'CanvasText'), paper: read('--surface', 'Canvas'), raised: read('--surface-raised', 'ButtonFace') };
}

/** A little over the theme's 200 ms colour transition (theme.css): when it has surely ended. */
const TRANSITION_MS = 250;

/**
 * The theme's colours, read again whenever the theme changes under the canvas (light, dark, a project's own). The tokens
 * transition, so a read as the change begins gets the old colours: it reads again as the transition ends, and on a
 * timer in case no end event comes.
 */
export function useCanvasColours(): CanvasColours {
  const [colours, setColours] = useState(themeColours);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      setColours(themeColours());
    };
    const observer = new MutationObserver(() => {
      read();
      clearTimeout(timer);
      timer = setTimeout(read, TRANSITION_MS);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    document.documentElement.addEventListener('transitionend', read);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      document.documentElement.removeEventListener('transitionend', read);
    };
  }, []);
  return colours;
}
