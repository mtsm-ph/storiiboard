import type { JsonValue } from '../../core/model/record';
import { cssVariables, type ModeTokens, type Theme } from './generator/generate';
import type { ResolvedTheme } from './theme';

// A project's own theme (1.15), as its record's `theme` prop stores it (docs/SBD_FORMAT.md, theme). The tokens are
// stored, never recomputed on open, so a newer generator can't change a look someone approved. Read with care: a
// prop from an older or a hand-edited file that isn't a whole theme reads as none, and the kit shows.

export interface ProjectTheme {
  /** The project's preferred mode, which Follow project takes. */
  mode: ResolvedTheme;
  light: ModeTokens;
  dark: ModeTokens;
}

/** The stored names, snake_case as in the file, for each token. */
const STORED: Readonly<Record<keyof ModeTokens, string>> = {
  bg: 'bg',
  surface: 'surface',
  surfaceRaised: 'surface_raised',
  border: 'border',
  borderTop: 'border_top',
  text: 'text',
  textMuted: 'text_muted',
  textInverse: 'text_inverse',
  accent: 'accent',
  accentContrast: 'accent_contrast',
};

const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function readTokens(value: unknown): ModeTokens | null {
  const stored = record(value);
  if (!stored) return null;
  const tokens: Partial<Record<keyof ModeTokens, string>> = {};
  for (const [key, name] of Object.entries(STORED) as [keyof ModeTokens, string][]) {
    const colour = stored[name];
    if (!isHex(colour)) return null;
    tokens[key] = colour.toUpperCase();
  }
  return tokens as ModeTokens;
}

/** The project's theme, or null for none (the kit) or one that can't be read. */
export function readProjectTheme(prop: unknown): ProjectTheme | null {
  const theme = record(prop);
  if (!theme || theme.source === 'default') return null;
  const tokens = record(theme.tokens);
  const light = readTokens(tokens?.light);
  const dark = readTokens(tokens?.dark);
  if (!light || !dark) return null;
  return { mode: theme.mode === 'dark' ? 'dark' : 'light', light, dark };
}

function storedTokens(tokens: ModeTokens): Record<string, JsonValue> {
  return Object.fromEntries((Object.entries(STORED) as [keyof ModeTokens, string][]).map(([key, name]) => [name, tokens[key]]));
}

/** The version of the generator that made a theme's tokens, stored with them. */
export const GENERATOR_VERSION = 1;

/** The `theme` prop for a generated theme, as onboarding and Settings → Theme store it (1.16). */
export function themeProp(
  theme: Theme,
  options: { source: 'image' | 'manual'; mode: ResolvedTheme; imageId: string | null; candidates: readonly string[] },
): Record<string, JsonValue> {
  return {
    version: 1,
    source: options.source,
    image_id: options.imageId,
    mode: options.mode,
    candidates: [...options.candidates],
    accent_picked: theme.source,
    family: theme.family,
    generator: GENERATOR_VERSION,
    tokens: { light: storedTokens(theme.light), dark: storedTokens(theme.dark) },
  };
}

const NAMES = Object.keys(cssVariables({} as ModeTokens));

/**
 * Sets a mode's tokens on <html>, or with null takes them off so the kit's own (src/ui/theme.css) show. With the
 * tokens registered in theme.css, the change eases over 200ms by itself.
 */
export function applyTokens(tokens: ModeTokens | null, root: HTMLElement = document.documentElement): void {
  if (!tokens) {
    for (const name of NAMES) root.style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(cssVariables(tokens))) root.style.setProperty(name, value);
}
