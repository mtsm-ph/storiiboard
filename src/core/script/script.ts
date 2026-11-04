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

// INT./EXT. and its spellings first, so INT doesn't match the start of INT./EXT.
const PREFIXES: readonly [RegExp, IntExt][] = [
  [/^(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E)\.?(?:\s+|$)/i, 'INT/EXT'],
  [/^INT\.?(?:\s+|$)/i, 'INT'],
  [/^(?:EXT|EST)\.?(?:\s+|$)/i, 'EXT'],
];

/** Times of day by the words scripts use; anything else is kept as written. */
const TIMES: Readonly<Record<string, DayNight>> = {
  DAY: 'DAY',
  NIGHT: 'NIGHT',
  DAWN: 'DAWN',
  SUNRISE: 'DAWN',
  DUSK: 'DUSK',
  SUNSET: 'DUSK',
  'MAGIC HOUR': 'MAGIC HOUR',
};

/** Whether a line starts like a scene heading: INT, EXT, EST, INT./EXT. or I/E, then a dot or a space. */
export function looksLikeHeading(line: string): boolean {
  return PREFIXES.some(([pattern]) => pattern.test(line.trim()));
}

/** Splits a heading into its parts: `INT. DINER - BACK ROOM - NIGHT` is INT, `DINER - BACK ROOM`, NIGHT. */
export function parseHeading(text: string): Pick<ScriptScene, 'heading' | 'intExt' | 'location' | 'dayNight' | 'otherTime'> {
  const heading = text.trim().replace(/\s+/g, ' ');
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
  // The place, then the time of day, then anything after it, split at dashes with spaces round them:
  // `KITCHEN - NIGHT - FLASHBACK` is KITCHEN, NIGHT and FLASHBACK.
  const parts = rest.split(/\s+[-–—]+\s+/).map((part) => part.trim());
  const timeOf = (part: string) =>
    Object.entries(TIMES).find(([word]) => part.toUpperCase() === word || part.toUpperCase().startsWith(`${word} `))?.[1] ?? null;
  // The last part that's a time of day, never the first (that's the place).
  let at = -1;
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (timeOf(parts[i] ?? '') !== null) {
      at = i;
      break;
    }
  }
  let location = rest.trim();
  let dayNight: DayNight | null = null;
  let otherTime: string | null = null;
  if (at !== -1) {
    location = parts.slice(0, at).join(' - ');
    dayNight = timeOf(parts[at] ?? '');
    otherTime = parts.slice(at + 1).join(' - ') || null;
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
  return cue
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
