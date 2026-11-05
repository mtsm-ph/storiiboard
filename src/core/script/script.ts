import { parsePages, type DayNight, type IntExt } from '../model/storyboard';

// What a script import reads (1.17, CLAUDE.md: script import): each scene's heading, by rule and never by AI, its
// speaking characters and its length. Shared by the app and, later, the MCP server's script tool, so it stays free of
// the UI and the file system.

export interface ScriptScene {
  /** The scene number the script prints, or null when it has none (the import numbers those). */
  number: string | null;
  /** The heading as written: `INT. KITCHEN - NIGHT`. */
  heading: string;
  intExt: IntExt | null;
  /** The place, as written: `KITCHEN`, or `DINER - BACK ROOM`. */
  location: string;
  dayNight: DayNight | null;
  /** A time of day the board has no value for (`CONTINUOUS`, `LATER`), kept so the heading still says it. */
  otherTime: string | null;
  /** Speaking characters in the order they first speak, without extensions such as (V.O.). */
  characters: string[];
  /** The scene's length in eighths of a page, at least 1. */
  eighths: number;
}

export interface Script {
  title: string | null;
  scenes: ScriptScene[];
}

// INT./EXT. and its spellings first, so INT doesn't match the start of INT./EXT. Spanish scripts (polish 7) write INT.
// and EXT. too, or spell them out: those whole words only in capitals, as a heading writes them, so an action line
// that starts "Exterior walls…" is never taken for one.
const PREFIXES: readonly [RegExp, IntExt][] = [
  [/^(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E)\.?(?:\s+|$)/i, 'INT/EXT'],
  [/^(?:INTERIOR\s*\/\s*EXTERIOR|EXTERIOR\s*\/\s*INTERIOR)\.?(?:\s+|$)/, 'INT/EXT'],
  [/^INT\.?(?:\s+|$)/i, 'INT'],
  [/^INTERIOR\.?(?:\s+|$)/, 'INT'],
  [/^(?:EXT|EST)\.?(?:\s+|$)/i, 'EXT'],
  [/^EXTERIOR\.?(?:\s+|$)/, 'EXT'],
];

/**
 * Times of day by the words scripts use, in English and in Spanish (polish 7), with or without accents; anything else
 * (CONTINUOUS, MÁS TARDE, MAÑANA) is kept as written.
 */
const TIMES: Readonly<Record<string, DayNight>> = {
  DAY: 'DAY',
  NIGHT: 'NIGHT',
  DAWN: 'DAWN',
  SUNRISE: 'DAWN',
  DUSK: 'DUSK',
  SUNSET: 'DUSK',
  'MAGIC HOUR': 'MAGIC HOUR',
  DÍA: 'DAY',
  DIA: 'DAY',
  NOCHE: 'NIGHT',
  AMANECER: 'DAWN',
  ALBA: 'DAWN',
  ATARDECER: 'DUSK',
  ANOCHECER: 'DUSK',
  CREPÚSCULO: 'DUSK',
  CREPUSCULO: 'DUSK',
  'HORA MÁGICA': 'MAGIC HOUR',
  'HORA MAGICA': 'MAGIC HOUR',
  'SALIDA DEL SOL': 'DAWN',
  'PUESTA DE SOL': 'DUSK',
  'PUESTA DEL SOL': 'DUSK',
  OCASO: 'DUSK',
};

/** Whether a line starts like a scene heading: INT, EXT, EST, INT./EXT. or I/E, then a dot or a space. */
export function looksLikeHeading(line: string): boolean {
  return PREFIXES.some(([pattern]) => pattern.test(line.trim()));
}

/** Splits a heading into its parts: `INT. DINER - BACK ROOM - NIGHT` is INT, `DINER - BACK ROOM`, NIGHT. */
export function parseHeading(text: string): Pick<ScriptScene, 'heading' | 'intExt' | 'location' | 'dayNight' | 'otherTime'> {
  // Composed, so an accent typed as a separate mark (D + ´ + A) reads as DÍA, and matches what the project has.
  const heading = text.normalize('NFC').trim().replace(/\s+/g, ' ');
  let rest = heading;
  let intExt: IntExt | null = null;
  for (const [pattern, value] of PREFIXES) {
    const match = pattern.exec(rest);
    if (match) {
      intExt = value;
      rest = rest.slice(match[0].length);
      break;
    }
  }
  // A full stop after the time ("NOCHE.") is the writer's, not part of it.
  const timeOf = (part: string) => {
    const said = part.toUpperCase().replace(/\.+$/, '');
    return Object.entries(TIMES).find(([word]) => said === word || said.startsWith(`${word} `))?.[1] ?? null;
  };
  // The last part that's a time of day, never the first (that's the place).
  const lastTime = (some: readonly string[]) => {
    for (let i = some.length - 1; i >= 1; i -= 1) if (timeOf(some[i] ?? '') !== null) return i;
    return -1;
  };
  // The place, then the time of day, then anything after it, split at dashes with spaces round them:
  // `KITCHEN - NIGHT - FLASHBACK` is KITCHEN, NIGHT and FLASHBACK.
  let parts = rest.split(/\s+[-–—]+\s+/).map((part) => part.trim());
  let joiner = ' - ';
  let at = lastTime(parts);
  // Many Spanish scripts separate them with full stops instead (`INT. CASA. NOCHE`, P7's low). Only when the dashes
  // give no time, and only if a time follows a full stop, so `ST. JAMES CHURCH` stays one place.
  if (at === -1 && intExt !== null) {
    const dotted = rest.split(/\.\s+/).map((part) => part.trim());
    const found = lastTime(dotted);
    if (found !== -1) {
      parts = dotted;
      joiner = '. ';
      at = found;
    }
  }
  let location = rest.trim();
  let dayNight: DayNight | null = null;
  let otherTime: string | null = null;
  if (at !== -1) {
    location = parts.slice(0, at).join(joiner);
    dayNight = timeOf(parts[at] ?? '');
    otherTime = parts.slice(at + 1).join(joiner).replace(/\.+$/, '') || null;
  } else if (intExt !== null && parts.length > 1) {
    // No time the board knows (CONTINUOUS, LATER): kept so the heading still says it. Without INT or EXT (a forced
    // `FLASHBACK - THE BRIDGE`) the whole text is the place.
    location = parts.slice(0, -1).join(' - ');
    otherTime = parts.at(-1) ?? null;
  }
  return { heading, intExt, location, dayNight, otherTime };
}

/** A character cue without its extensions: `MARY (V.O.)` and `MARY (CONT'D)` are MARY; dual dialogue's ^ goes too. */
export function characterName(cue: string): string {
  // Composed, as headings are, so MARÍA typed two ways is one character.
  return cue
    .normalize('NFC')
    .replace(/\^\s*$/, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Standard script pages hold about 55 lines; a scene is never shorter than an eighth. */
export const LINES_PER_PAGE = 55;

export function eighthsFromLines(lines: number): number {
  return Math.max(1, Math.round((lines * 8) / LINES_PER_PAGE));
}

/** `1 3/8` as Final Draft writes a scene's length, in eighths: 11. Null for anything else, or for nothing. */
export function eighthsFromLength(length: string): number | null {
  const eighths = parsePages(length);
  return eighths !== null && eighths > 0 ? eighths : null;
}

/** How many printed lines a block of text takes at a given width in characters (Courier 12, as scripts are set). */
export function printedLines(text: string, width: number): number {
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
}
