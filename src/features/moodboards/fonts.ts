import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { isTauriApp } from '../../app/fileAccess';
import { showInfo } from '../../app/notice';
import { t } from '../../core/i18n';
import { DEFAULT_FONT_FAMILY } from './items';

// The fonts a board's text can use (5.1a, decision 7): the bundled ones first (src/ui/fonts), then this computer's,
// listed through Rust with font-kit (src-tauri/src/fonts.rs). The page draws a system font by loading its bytes from
// Rust into a FontFace, once per font per session, so it doesn't depend on what the webview lets pages see. Font bytes
// are never stored in the project: a board keeps only family, weight and italic. The browser build has no Rust and
// lists only the bundled fonts.

export interface FontStyleEntry {
  weight: number;
  /** The weight the font itself says, when it differs from `weight` (rounded to 100): keeps two faces apart. */
  realWeight?: number;
  italic: boolean;
  postscriptName: string;
}

export interface FontFamilyEntry {
  name: string;
  bundled: boolean;
  styles: readonly FontStyleEntry[];
}

interface Bundled {
  name: string;
  /** The lightest and heaviest weight the file holds (variable fonts hold the range). */
  weights: readonly [number, number];
  /** Whether the family has an italic file. */
  italic: boolean;
  /** Loaded by the app's own CSS already (fonts-app.css); the others are loaded here, when a board uses them. */
  inCss: boolean;
  upright: string;
  slanted: string | null;
}

// Vite needs each file named in full to bundle it.
export const BUNDLED: readonly Bundled[] = [
  { name: 'Inter Tight', weights: [100, 900], italic: true, inCss: true, upright: '', slanted: '' },
  { name: 'JetBrains Mono', weights: [100, 800], italic: true, inCss: true, upright: '', slanted: '' },
  {
    name: 'Archivo',
    weights: [100, 900],
    italic: true,
    inCss: false,
    upright: new URL('../../ui/fonts/archivo/Archivo[wdth,wght].ttf', import.meta.url).href,
    slanted: new URL('../../ui/fonts/archivo/Archivo-Italic[wdth,wght].ttf', import.meta.url).href,
  },
  {
    name: 'Bodoni Moda',
    weights: [400, 900],
    italic: true,
    inCss: false,
    upright: new URL('../../ui/fonts/bodonimoda/BodoniModa[opsz,wght].ttf', import.meta.url).href,
    slanted: new URL('../../ui/fonts/bodonimoda/BodoniModa-Italic[opsz,wght].ttf', import.meta.url).href,
  },
  {
    name: 'Jost',
    weights: [100, 900],
    italic: true,
    inCss: false,
    upright: new URL('../../ui/fonts/jost/Jost[wght].ttf', import.meta.url).href,
    slanted: new URL('../../ui/fonts/jost/Jost-Italic[wght].ttf', import.meta.url).href,
  },
  {
    name: 'Outfit',
    weights: [100, 900],
    italic: false,
    inCss: false,
    upright: new URL('../../ui/fonts/outfit/Outfit[wght].ttf', import.meta.url).href,
    slanted: null,
  },
];

const weightsOf = ([low, high]: readonly [number, number]) => Array.from({ length: (high - low) / 100 + 1 }, (_, i) => low + i * 100);

/** The bundled families as the list shows them: every weight of the file, upright and italic where there is one. */
export const BUNDLED_FAMILIES: readonly FontFamilyEntry[] = BUNDLED.map((font) => ({
  name: font.name,
  bundled: true,
  styles: weightsOf(font.weights).flatMap((weight) => [
    { weight, italic: false, postscriptName: '' },
    ...(font.italic ? [{ weight, italic: true, postscriptName: '' }] : []),
  ]),
}));

export const isBundled = (family: string): boolean => BUNDLED.some((font) => font.name === family);

/** The OpenType licensing bits kept with a loaded font, for 5.6's PDF rule: never embed a font whose bits forbid it. */
export interface FsType {
  restricted: boolean;
  previewPrint: boolean;
  editable: boolean;
  noSubsetting: boolean;
  bitmapOnly: boolean;
  raw: number;
}

export function fsTypeFromBits(raw: number): FsType {
  return {
    restricted: (raw & 0x0002) !== 0,
    previewPrint: (raw & 0x0004) !== 0,
    editable: (raw & 0x0008) !== 0,
    noSubsetting: (raw & 0x0100) !== 0,
    bitmapOnly: (raw & 0x0200) !== 0,
    raw,
  };
}

/** What `font_bytes` sends: a three-byte header (1 if the font has an OS/2 table, then fsType, big-endian), then the file. */
export function parseFontPayload(payload: ArrayBuffer): { fsType: FsType | null; data: ArrayBuffer } | null {
  if (payload.byteLength <= 3) return null;
  const view = new DataView(payload);
  const fsType = view.getUint8(0) === 1 ? fsTypeFromBits(view.getUint16(1, false)) : null;
  return { fsType, data: payload.slice(3) };
}

/** The style of a family nearest to what a board asks for: the same slant first, then the closest weight. */
export function nearestStyle<T extends { weight: number; realWeight?: number; italic: boolean }>(styles: readonly T[], weight: number, italic: boolean): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const style of styles) {
    // The real weight breaks a tie between faces that round alike.
    const score = (style.italic === italic ? 0 : 1000) + Math.abs(style.weight - weight) + Math.abs((style.realWeight ?? style.weight) - weight) / 1000;
    if (score < bestScore) {
      best = style;
      bestScore = score;
    }
  }
  return best;
}

interface FontsState {
  /**
   * Idle: not asked yet; ready: the list is known (the browser build is ready at once, with no system fonts); failed:
   * Rust couldn't list them, so no system font is called missing.
   */
  status: 'idle' | 'loading' | 'ready' | 'failed';
  system: readonly FontFamilyEntry[];
  /** Faces (family, weight, italic: see faceKey) that failed to load: drawn in Inter Tight, and reported as unreadable. */
  broken: readonly string[];
  /** Bumped when a face finishes loading, so what is drawn with it is drawn again. */
  version: number;
}

export const fontsStore = createStore<FontsState>()(() => ({ status: isTauriApp ? 'idle' : 'ready', system: [], broken: [], version: 0 }));

const faces = new Map<string, Promise<void>>();
const settled = new Set<string>();
const fsTypes = new Map<string, FsType | null>();

/** The licensing bits of a system font loaded this session (null: no OS/2 table, or not loaded). */
export const fsTypeOf = (postscriptName: string): FsType | null => fsTypes.get(postscriptName) ?? null;

interface ListedFamily {
  name: string;
  styles: readonly FontStyleEntry[];
}

/** This computer's families, once per session. A list that can't be read leaves the bundled fonts alone. */
export function loadSystemFonts(): Promise<void> {
  if (fontsStore.getState().status !== 'idle') return Promise.resolve();
  fontsStore.setState({ status: 'loading' });
  return invoke<ListedFamily[]>('fonts_list').then(
    (listed) => {
      setSystemFonts(listed);
    },
    () => {
      // Said once; the board keeps every font's name, and none is called missing without a list to check against.
      fontsStore.setState({ status: 'failed' });
      showInfo(t('moodboard.fontsNotListed'));
    },
  );
}

/** Sets the computer's list; the bundled families come first and a system font of the same name is left out. */
export function setSystemFonts(listed: readonly ListedFamily[]): void {
  const system = listed.filter((f) => !isBundled(f.name) && f.styles.length > 0).map((f) => ({ name: f.name, bundled: false, styles: f.styles }));
  fontsStore.setState({ status: 'ready', system });
}

/** Every family a board can use, in the order the list shows them. */
export const familiesOf = (system: readonly FontFamilyEntry[]): FontFamilyEntry[] => [...BUNDLED_FAMILIES, ...system];

export type Availability = 'bundled' | 'system' | 'missing' | 'pending';

/** Where a family is: with the app, on this computer, nowhere (a board from another computer), or not known yet. */
type FontsView = Pick<FontsState, 'status' | 'system'> & { broken?: readonly string[] };

export function availability(family: string, state: FontsView): Availability {
  if (isBundled(family)) return 'bundled';
  if (state.system.some((f) => f.name === family)) return 'system';
  return state.status === 'ready' ? 'missing' : 'pending';
}

export const faceKey = (family: string, weight: number, italic: boolean): string => [family, String(weight), String(italic)].join('|');

type Face = { weight: number; italic: boolean };

/** Whether this very face failed to load, though the font is on the computer: one bad face is not the whole family. */
export const isBroken = (family: string, face: Face, state: FontsView): boolean => state.broken?.includes(faceKey(family, face.weight, face.italic)) === true;

/** The family a board's text is drawn in: its own, else Inter Tight when this computer lacks it or its face can't be read. */
export const drawnFamily = (family: string, state: FontsView, face?: Face): string =>
  availability(family, state) === 'missing' || (face !== undefined && isBroken(family, face, state)) ? DEFAULT_FONT_FAMILY : family;

/** The families a board names that this computer lacks, once the list is known, each once. */
export function missingFamilies(names: Iterable<string>, state: FontsView): string[] {
  return [...new Set(names)].filter((name) => availability(name, state) === 'missing');
}

/** The names not yet said on this board, remembered in `reported` so each is said once per session. */
export function unreported(boardId: string, names: readonly string[], reported: Set<string>): string[] {
  return names.filter((name) => {
    const key = `${boardId}\n${name}`;
    if (reported.has(key)) return false;
    reported.add(key);
    return true;
  });
}

/** The family list text and the canvas draw with: the font, then Inter Tight, so a face still loading never shows the browser's default. */
export function cssFamily(family: string, state: FontsView, face?: Face): string {
  const quoted = (name: string) => `"${name.replace(/[\\"]/g, '\\$&')}"`;
  const drawn = drawnFamily(family, state, face);
  return drawn === DEFAULT_FONT_FAMILY ? quoted(drawn) : `${quoted(drawn)}, ${quoted(DEFAULT_FONT_FAMILY)}`;
}

/** The faces named that are on the computer but couldn't be read, each family once. */
export function unreadableFamilies(faces: readonly { fontFamily: string; fontWeight: number; fontItalic: boolean }[], state: FontsView): string[] {
  return [...new Set(faces.filter((f) => isBroken(f.fontFamily, { weight: f.fontWeight, italic: f.fontItalic }, state)).map((f) => f.fontFamily))];
}

/** What a board shows as missing now and hasn't said yet: each name once per board per session. */
export function newlyMissing(boardId: string, families: Iterable<string>, state: FontsView, reported: Set<string>): string[] {
  return unreported(boardId, missingFamilies(families, state), reported);
}

const cssWeight = (weight: number) => String(weight);

function loadBundled(font: Bundled, weight: number, italic: boolean): [string, Promise<void>] {
  if (typeof document === 'undefined') return ['none', Promise.resolve()];
  const spec = `${italic ? 'italic ' : ''}${String(weight)} 16px "${font.name}"`;
  if (font.inCss) return [`css|${spec}`, document.fonts.load(spec).then(() => undefined)];
  const file = italic && font.slanted ? font.slanted : font.upright;
  const slant = italic && font.slanted ? 'italic' : 'normal';
  const key = `bundled|${font.name}|${slant}`;
  let loading = faces.get(key);
  if (!loading) {
    const face = new FontFace(font.name, `url("${file}")`, { weight: `${String(font.weights[0])} ${String(font.weights[1])}`, style: slant });
    loading = face.load().then((loaded) => {
      document.fonts.add(loaded);
    });
    faces.set(key, loading);
  }
  return [key, loading];
}

function loadSystem(family: FontFamilyEntry, weight: number, italic: boolean): [string, Promise<void>] {
  const style = nearestStyle(family.styles, weight, italic);
  if (!style || typeof FontFace === 'undefined') return ['none', Promise.resolve()];
  const key = `system|${style.postscriptName}`;
  let loading = faces.get(key);
  if (!loading) {
    loading = invoke<ArrayBuffer>('font_bytes', { postscriptName: style.postscriptName }).then(async (payload) => {
      const parsed = parseFontPayload(payload);
      if (!parsed) return;
      fsTypes.set(style.postscriptName, parsed.fsType);
      const face = new FontFace(family.name, parsed.data, { weight: cssWeight(style.realWeight ?? style.weight), style: style.italic ? 'italic' : 'normal' });
      document.fonts.add(await face.load());
    });
    faces.set(key, loading);
  }
  return [key, loading];
}

/** Has the page draw a font: loads it once, and tells what is drawn with it to draw again. Never throws. */
export function ensureFont(family: string, weight: number, italic: boolean): Promise<void> {
  const bundled = BUNDLED.find((font) => font.name === family);
  const entry = bundled ? undefined : fontsStore.getState().system.find((f) => f.name === family);
  const [key, loading] = bundled ? loadBundled(bundled, weight, italic) : entry ? loadSystem(entry, weight, italic) : ['none', Promise.resolve()];
  return loading.then(
    () => {
      // Only a face that was not drawable before changes what is drawn.
      if (key === 'none' || settled.has(key)) return;
      settled.add(key);
      fontsStore.setState((s) => ({ version: s.version + 1 }));
    },
    () => {
      // A face that can't load is drawn in Inter Tight and reported like a missing one.
      const bad = faceKey(family, weight, italic);
      fontsStore.setState((s) => ({ broken: s.broken.includes(bad) ? s.broken : [...s.broken, bad], version: s.version + 1 }));
    },
  );
}

/** How long an edit waits for its font before measuring with whatever is drawable. */
export const FONT_WAIT_MS = 5000;

/**
 * ensureFont for an edit waiting in the project's queue: every later edit, undo and delete waits behind it, so a font
 * that never settles (a stuck read in Rust, a webview that never answers) must not hold them. After the wait the text
 * is measured in what's drawable, the fallback at worst, and the font still loads in the background.
 */
export function fontReady(family: string, weight: number, italic: boolean, ms = FONT_WAIT_MS, load = ensureFont): Promise<void> {
  const key = faceKey(family, weight, italic);
  // A face that already kept an edit waiting the whole limit is not waited for again until it settles.
  const slow = timedOut.has(key);
  return new Promise<void>((resolve) => {
    const timer = slow
      ? undefined
      : setTimeout(() => {
          timedOut.add(key);
          resolve();
        }, ms);
    const done = () => {
      clearTimeout(timer);
      timedOut.delete(key);
      resolve();
    };
    if (slow) resolve();
    load(family, weight, italic).then(done, done);
  });
}

/** Faces whose wait ran out and whose load has not settled yet. */
const timedOut = new Set<string>();

/** The fonts state, for a component that draws or lists fonts. */
export function useFonts<T>(select: (state: FontsState) => T): T {
  return useStore(fontsStore, select);
}
