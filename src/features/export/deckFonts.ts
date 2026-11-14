import { invoke } from '@tauri-apps/api/core';
import { fontsStore, nearestStyle, parseFontPayload } from '../moodboards/fonts';
import type { FontLoader } from './deckPdfWriter';

// Where a deck's PDF gets a font's file (5.6a, decision 7; 5.10): the app's bundled families from their publishers' static files
// in ./fonts (one file per weight, upright and italic where the family has one: ./fonts/README.md), or a computer's font through
// Rust (fonts.rs). Whether the file may be embedded is decided from its own `fsType` bits by the writer (deckFontRules.ts), not here.
//
// A bundled family prints at the exact weight a board gives it, in the exact slant where it has one, so nothing is substituted. The
// canvas draws the same families from the variable files in src/ui/fonts; those are not read here. Outfit has no italic: its slant
// is made, as a computer's font without one is.

const bytesOf = async (url: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(url)).arrayBuffer());

interface StaticFile {
  weight: number;
  italic: boolean;
  load: () => Promise<{ default: string }>;
}

/** The static files, by family. Each `import()` is named in full so Vite bundles it, and runs only when a PDF needs that weight. */
export const STATIC: Readonly<Record<string, readonly StaticFile[]>> = {
  'Inter Tight': [
    { weight: 100, italic: false, load: () => import('./fonts/InterTight-Thin.ttf?url') },
    { weight: 100, italic: true, load: () => import('./fonts/InterTight-ThinItalic.ttf?url') },
    { weight: 200, italic: false, load: () => import('./fonts/InterTight-ExtraLight.ttf?url') },
    { weight: 200, italic: true, load: () => import('./fonts/InterTight-ExtraLightItalic.ttf?url') },
    { weight: 300, italic: false, load: () => import('./fonts/InterTight-Light.ttf?url') },
    { weight: 300, italic: true, load: () => import('./fonts/InterTight-LightItalic.ttf?url') },
    { weight: 400, italic: false, load: () => import('./fonts/InterTight-Regular.ttf?url') },
    { weight: 400, italic: true, load: () => import('./fonts/InterTight-Italic.ttf?url') },
    { weight: 500, italic: false, load: () => import('./fonts/InterTight-Medium.ttf?url') },
    { weight: 500, italic: true, load: () => import('./fonts/InterTight-MediumItalic.ttf?url') },
    { weight: 600, italic: false, load: () => import('./fonts/InterTight-SemiBold.ttf?url') },
    { weight: 600, italic: true, load: () => import('./fonts/InterTight-SemiBoldItalic.ttf?url') },
    { weight: 700, italic: false, load: () => import('./fonts/InterTight-Bold.ttf?url') },
    { weight: 700, italic: true, load: () => import('./fonts/InterTight-BoldItalic.ttf?url') },
    { weight: 800, italic: false, load: () => import('./fonts/InterTight-ExtraBold.ttf?url') },
    { weight: 800, italic: true, load: () => import('./fonts/InterTight-ExtraBoldItalic.ttf?url') },
    { weight: 900, italic: false, load: () => import('./fonts/InterTight-Black.ttf?url') },
    { weight: 900, italic: true, load: () => import('./fonts/InterTight-BlackItalic.ttf?url') },
  ],
  'JetBrains Mono': [
    { weight: 100, italic: false, load: () => import('./fonts/JetBrainsMono-Thin.ttf?url') },
    { weight: 100, italic: true, load: () => import('./fonts/JetBrainsMono-ThinItalic.ttf?url') },
    { weight: 200, italic: false, load: () => import('./fonts/JetBrainsMono-ExtraLight.ttf?url') },
    { weight: 200, italic: true, load: () => import('./fonts/JetBrainsMono-ExtraLightItalic.ttf?url') },
    { weight: 300, italic: false, load: () => import('./fonts/JetBrainsMono-Light.ttf?url') },
    { weight: 300, italic: true, load: () => import('./fonts/JetBrainsMono-LightItalic.ttf?url') },
    { weight: 400, italic: false, load: () => import('./fonts/JetBrainsMono-Regular.ttf?url') },
    { weight: 400, italic: true, load: () => import('./fonts/JetBrainsMono-Italic.ttf?url') },
    { weight: 500, italic: false, load: () => import('./fonts/JetBrainsMono-Medium.ttf?url') },
    { weight: 500, italic: true, load: () => import('./fonts/JetBrainsMono-MediumItalic.ttf?url') },
    { weight: 600, italic: false, load: () => import('./fonts/JetBrainsMono-SemiBold.ttf?url') },
    { weight: 600, italic: true, load: () => import('./fonts/JetBrainsMono-SemiBoldItalic.ttf?url') },
    { weight: 700, italic: false, load: () => import('./fonts/JetBrainsMono-Bold.ttf?url') },
    { weight: 700, italic: true, load: () => import('./fonts/JetBrainsMono-BoldItalic.ttf?url') },
    { weight: 800, italic: false, load: () => import('./fonts/JetBrainsMono-ExtraBold.ttf?url') },
    { weight: 800, italic: true, load: () => import('./fonts/JetBrainsMono-ExtraBoldItalic.ttf?url') },
  ],
  'Archivo': [
    { weight: 100, italic: false, load: () => import('./fonts/Archivo-Thin.ttf?url') },
    { weight: 100, italic: true, load: () => import('./fonts/Archivo-ThinItalic.ttf?url') },
    { weight: 200, italic: false, load: () => import('./fonts/Archivo-ExtraLight.ttf?url') },
    { weight: 200, italic: true, load: () => import('./fonts/Archivo-ExtraLightItalic.ttf?url') },
    { weight: 300, italic: false, load: () => import('./fonts/Archivo-Light.ttf?url') },
    { weight: 300, italic: true, load: () => import('./fonts/Archivo-LightItalic.ttf?url') },
    { weight: 400, italic: false, load: () => import('./fonts/Archivo-Regular.ttf?url') },
    { weight: 400, italic: true, load: () => import('./fonts/Archivo-Italic.ttf?url') },
    { weight: 500, italic: false, load: () => import('./fonts/Archivo-Medium.ttf?url') },
    { weight: 500, italic: true, load: () => import('./fonts/Archivo-MediumItalic.ttf?url') },
    { weight: 600, italic: false, load: () => import('./fonts/Archivo-SemiBold.ttf?url') },
    { weight: 600, italic: true, load: () => import('./fonts/Archivo-SemiBoldItalic.ttf?url') },
    { weight: 700, italic: false, load: () => import('./fonts/Archivo-Bold.ttf?url') },
    { weight: 700, italic: true, load: () => import('./fonts/Archivo-BoldItalic.ttf?url') },
    { weight: 800, italic: false, load: () => import('./fonts/Archivo-ExtraBold.ttf?url') },
    { weight: 800, italic: true, load: () => import('./fonts/Archivo-ExtraBoldItalic.ttf?url') },
    { weight: 900, italic: false, load: () => import('./fonts/Archivo-Black.ttf?url') },
    { weight: 900, italic: true, load: () => import('./fonts/Archivo-BlackItalic.ttf?url') },
  ],
  'Bodoni Moda': [
    { weight: 400, italic: false, load: () => import('./fonts/BodoniModa-Regular.ttf?url') },
    { weight: 400, italic: true, load: () => import('./fonts/BodoniModa-Italic.ttf?url') },
    { weight: 500, italic: false, load: () => import('./fonts/BodoniModa-Medium.ttf?url') },
    { weight: 500, italic: true, load: () => import('./fonts/BodoniModa-MediumItalic.ttf?url') },
    { weight: 600, italic: false, load: () => import('./fonts/BodoniModa-SemiBold.ttf?url') },
    { weight: 600, italic: true, load: () => import('./fonts/BodoniModa-SemiBoldItalic.ttf?url') },
    { weight: 700, italic: false, load: () => import('./fonts/BodoniModa-Bold.ttf?url') },
    { weight: 700, italic: true, load: () => import('./fonts/BodoniModa-BoldItalic.ttf?url') },
    { weight: 800, italic: false, load: () => import('./fonts/BodoniModa-ExtraBold.ttf?url') },
    { weight: 800, italic: true, load: () => import('./fonts/BodoniModa-ExtraBoldItalic.ttf?url') },
    { weight: 900, italic: false, load: () => import('./fonts/BodoniModa-Black.ttf?url') },
    { weight: 900, italic: true, load: () => import('./fonts/BodoniModa-BlackItalic.ttf?url') },
  ],
  'Jost': [
    { weight: 100, italic: false, load: () => import('./fonts/Jost-Thin.ttf?url') },
    { weight: 100, italic: true, load: () => import('./fonts/Jost-ThinItalic.ttf?url') },
    { weight: 200, italic: false, load: () => import('./fonts/Jost-ExtraLight.ttf?url') },
    { weight: 200, italic: true, load: () => import('./fonts/Jost-ExtraLightItalic.ttf?url') },
    { weight: 300, italic: false, load: () => import('./fonts/Jost-Light.ttf?url') },
    { weight: 300, italic: true, load: () => import('./fonts/Jost-LightItalic.ttf?url') },
    { weight: 400, italic: false, load: () => import('./fonts/Jost-Regular.ttf?url') },
    { weight: 400, italic: true, load: () => import('./fonts/Jost-Italic.ttf?url') },
    { weight: 500, italic: false, load: () => import('./fonts/Jost-Medium.ttf?url') },
    { weight: 500, italic: true, load: () => import('./fonts/Jost-MediumItalic.ttf?url') },
    { weight: 600, italic: false, load: () => import('./fonts/Jost-SemiBold.ttf?url') },
    { weight: 600, italic: true, load: () => import('./fonts/Jost-SemiBoldItalic.ttf?url') },
    { weight: 700, italic: false, load: () => import('./fonts/Jost-Bold.ttf?url') },
    { weight: 700, italic: true, load: () => import('./fonts/Jost-BoldItalic.ttf?url') },
    { weight: 800, italic: false, load: () => import('./fonts/Jost-ExtraBold.ttf?url') },
    { weight: 800, italic: true, load: () => import('./fonts/Jost-ExtraBoldItalic.ttf?url') },
    { weight: 900, italic: false, load: () => import('./fonts/Jost-Black.ttf?url') },
    { weight: 900, italic: true, load: () => import('./fonts/Jost-BlackItalic.ttf?url') },
  ],
  'Outfit': [
    { weight: 100, italic: false, load: () => import('./fonts/Outfit-Thin.ttf?url') },
    { weight: 200, italic: false, load: () => import('./fonts/Outfit-ExtraLight.ttf?url') },
    { weight: 300, italic: false, load: () => import('./fonts/Outfit-Light.ttf?url') },
    { weight: 400, italic: false, load: () => import('./fonts/Outfit-Regular.ttf?url') },
    { weight: 500, italic: false, load: () => import('./fonts/Outfit-Medium.ttf?url') },
    { weight: 600, italic: false, load: () => import('./fonts/Outfit-SemiBold.ttf?url') },
    { weight: 700, italic: false, load: () => import('./fonts/Outfit-Bold.ttf?url') },
    { weight: 800, italic: false, load: () => import('./fonts/Outfit-ExtraBold.ttf?url') },
    { weight: 900, italic: false, load: () => import('./fonts/Outfit-Black.ttf?url') },
  ],
};

/** The file of a bundled family for a weight and slant: the exact weight, the slant where the family has one, else the weight upright. */
function staticFile(files: readonly StaticFile[], weight: number, italic: boolean): { file: StaticFile; made: boolean } | null {
  const slanted = italic && files.some((file) => file.italic);
  const pool = files.filter((file) => file.italic === slanted);
  let best: StaticFile | null = null;
  // Exact for any weight a board can give the family; the nearest only for one outside its range (an older board).
  for (const file of pool) if (best === null || Math.abs(file.weight - weight) < Math.abs(best.weight - weight)) best = file;
  return best ? { file: best, made: italic && !slanted } : null;
}

const cache = new Map<string, Promise<Uint8Array>>();
const cached = (key: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> => {
  let made = cache.get(key);
  if (!made) {
    made = load();
    // A failed read is asked for again next time.
    made.catch(() => cache.delete(key));
    cache.set(key, made);
  }
  return made;
};

/** The loader the app's deck export uses. Null for a family neither bundled nor on this computer. */
export const deckFontLoader: FontLoader = async (family, weight, italic) => {
  const files = STATIC[family];
  if (files) {
    const chosen = staticFile(files, weight, italic);
    if (!chosen) return null;
    const key = `static|${family}|${String(chosen.file.weight)}|${chosen.file.italic ? 'italic' : 'upright'}`;
    const bytes = await cached(key, async () => bytesOf((await chosen.file.load()).default));
    // A bundled font's bold is never made; its slant only where the family has no italic (Outfit).
    return { key, bytes, synthBold: false, synthItalic: chosen.made };
  }
  const entry = fontsStore.getState().system.find((f) => f.name === family);
  if (!entry) return null;
  const style = nearestStyle(entry.styles, weight, italic);
  if (!style) return null;
  const key = `system|${style.postscriptName}`;
  const bytes = await cached(key, async () => {
    const parsed = parseFontPayload(await invoke<ArrayBuffer>('font_bytes', { postscriptName: style.postscriptName }));
    if (!parsed) throw new Error('That font can’t be read.');
    return new Uint8Array(parsed.data);
  });
  return { key, bytes, synthBold: weight >= 600 && (style.realWeight ?? style.weight) < 550, synthItalic: italic && !style.italic };
};
