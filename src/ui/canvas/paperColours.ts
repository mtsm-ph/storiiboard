import type { CanvasColours } from './types';

// Content that is never themed (5.1a boards, decision 13 plans): the light theme's paper, ink and raised surface, fixed
// in both themes, so a board or a plan looks the same in light and dark and prints as seen. Shared here, so a board and
// a plan never keep their own copy of the values.

export const PAPER = '#EEE9DF';
export const INK = '#16150F';
export const RAISED = '#C9C1B1';

/** What a canvas whose content is never themed is drawn in (its `fixedColours`). */
export const PAPER_COLOURS: CanvasColours = { ink: INK, paper: PAPER, raised: RAISED };

/**
 * The lighting department's fixed colour (design/tokens, `--sb-dept-lighting`, mustard): department colours are tags
 * that never change with the theme, so a plan (never themed, decision 13) draws a light's beam in it (6.5).
 */
export const DEPT_LIGHTING = '#D9A23D';

/**
 * Golden hour's fixed colour (design/tokens, `--sb-highlight`, Burning Flame): never themed, so a plan's sun path (6.6,
 * never themed either) draws its golden-hour arc in it, as a call sheet marks golden hour.
 */
export const GOLDEN_HOUR = '#FFB162';
