import tokens from '../../../design/tokens/tokens.json';
import type { CanvasViewChoice } from '../../core/storage/settings';
import { INK, PAPER, PAPER_COLOURS } from './paperColours';
import type { CanvasColours } from './types';

// The two ways a plan or a board can be looked at on this computer (6.5.1, Kevin, Nov 16): Paper, as it prints, or Dark,
// a view only. Dark is never part of the board: nothing is stored in a project, and every export and print takes the
// paper palette whatever the setting says. In Dark the canvas is the dark theme's page and whatever has no colour of its
// own is drawn in the dark theme's text colour (paper), or, where it sits on a light fill, in whichever ink reads on that
// fill (inkOn); a colour a person chose, a picture or a department's colour is drawn as it is. The values are the design
// kit's dark tokens (design/tokens/tokens.json), never typed here. A palette says it is Dark by its `dark` field, never by
// being this very object, so a copy of it (a context with its ink chosen for what lies under an item) still draws as Dark.

/** The Dark view's palette: the dark theme's page for the canvas, its text colour for ink, its well for the raised surface. */
export const DARK_COLOURS: CanvasColours = {
  ink: tokens.color.dark.ink,
  paper: tokens.color.dark.paper,
  raised: tokens.color.dark.oatmeal,
  dark: true,
  // A plan label's halo is the dark page behind its light ink.
  halo: tokens.color.dark.paper,
};

/** What a canvas in this view is drawn in; the same object every time, so the canvas keeps what it drew until the view changes. */
export const canvasPalette = (view: CanvasViewChoice): CanvasColours => (view === 'dark' ? DARK_COLOURS : PAPER_COLOURS);

/** Whether a palette is the Dark view's (or a copy of it). */
export const isDark = (colours: CanvasColours | undefined): boolean => colours?.dark === true;

/** A muted ink for this palette: the dark theme's muted text in the Dark view, else the host's own (a board's fixed muted). */
export const mutedIn = (colours: CanvasColours, paperMuted: string): string => (isDark(colours) ? tokens.color.dark.muted : paperMuted);

/** A `#RRGGBB` (or `#RGB`) colour's relative luminance, as WCAG 2 works it out; null for anything else. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const full = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((at) => {
    const c = parseInt(full.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours (1 to 21); null when either can't be read. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The ink for something with no colour of its own (6.5.1 round 2) drawn on `fill`, the fill drawn underneath it (a deck
 * page's background, a section's tint, a sticky's swatch, a shape's fill, a plan icon's own fill); null for the bare
 * canvas. On paper, and for every export, the palette's ink as always. In Dark, whichever of the Dark view's light ink and
 * the paper palette's ink has the higher contrast against that fill, so default words on a white page stay ink.
 */
export function inkOn(colours: CanvasColours, fill: string | null): string {
  if (!isDark(colours) || fill === null) return colours.ink;
  // The Dark view's own light ink, not `colours.ink`: a copy may already carry the ink chosen for something else.
  const lightInk = DARK_COLOURS.ink;
  const light = contrastRatio(lightInk, fill);
  const dark = contrastRatio(INK, fill);
  if (light === null || dark === null) return lightInk;
  return dark > light ? INK : lightInk;
}

/**
 * The words on a fill a person chose (6.5.7a: a sticky in a colour of its own), for words with no colour of their own:
 * ink or paper, whichever has the higher WCAG contrast against the fill (ink on a tie, or on a fill that can't be read).
 * The same in Paper and Dark and in every export: a chosen fill doesn't change with the view, so neither do its words.
 */
export function wordsOn(fill: string): string {
  const ink = contrastRatio(INK, fill);
  const paper = contrastRatio(PAPER, fill);
  return ink !== null && paper !== null && paper > ink ? PAPER : INK;
}

/**
 * A plan icon's line (its stroke) as the palette draws it (6.5.1 round 3): in Dark the kit's ink lines are the light ink,
 * so they read on the dark page; every other hex is the kit's. A kit FILL is never passed here: an ink fill is real black
 * cloth (a flag), a white one a bounce's face, and they stay as the kit draws them. On paper, and for every export, each
 * hex is exactly the kit's.
 */
export function kitStroke(hex: string, colours: CanvasColours): string {
  if (!isDark(colours)) return hex;
  return hex.toUpperCase() === INK ? colours.ink : hex;
}
