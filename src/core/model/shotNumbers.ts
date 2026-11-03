// Shot and scene numbers as they go on the slate (CLAUDE.md, Film vocabulary). Editors match footage to the board by
// these, so they're worked out by fixed rules (Kevin's calls, Nov 2):
//
// - A shot is its scene's number plus a letter: 4A, 4B, 4C. Letters skip I and O by default, as most slates do,
//   because they read as 1 and 0; a project can allow them. After Z come AA, AB, and so on.
// - Until a scene's numbers are locked, they follow the board: insert, move or delete a shot and the letters close
//   up. Once locked (they're on slates, or with the editor), every shot keeps its number, a new shot takes the next
//   free letter wherever it sits, and a deleted shot's letter isn't given out again.
// - A scene added between 4 and 5 is 4A, the way scripts number added scenes.

export interface LetterOptions {
  /** Skip I and O. On unless the project allows them. */
  skipIO: boolean;
}

const ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const WITHOUT_I_O = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const alphabet = ({ skipIO }: LetterOptions) => (skipIO ? WITHOUT_I_O : ALL);

/** The letters for the shot at `index` in its scene: 0 → A, 23 → Z (without I and O), 24 → AA. */
export function letterFor(index: number, options: LetterOptions): string {
  const letters = alphabet(options);
  let n = index + 1;
  let out = '';
  while (n > 0) {
    n -= 1;
    out = (letters[n % letters.length] ?? '') + out;
    n = Math.floor(n / letters.length);
  }
  return out;
}

/** The index letterFor would give these letters, or null if they aren't valid letters under these options. */
export function letterIndex(letters: string, options: LetterOptions): number | null {
  const alpha = alphabet(options);
  if (letters === '') return null;
  let n = 0;
  for (const char of letters) {
    const digit = alpha.indexOf(char);
    if (digit === -1) return null;
    n = n * alpha.length + digit + 1;
  }
  return n - 1;
}

/** A shot's letters, given its scene's number: "4AB" in scene 4 → "AB". Null if it isn't numbered from this scene. */
export function lettersOf(shotNumber: string, sceneNumber: string): string | null {
  if (!shotNumber.startsWith(sceneNumber)) return null;
  const rest = shotNumber.slice(sceneNumber.length);
  return /^[A-Z]+$/.test(rest) ? rest : null;
}

export interface NumberedShot {
  id: string;
  /** The stored number, or '' for a shot that has none yet. */
  number: string;
  /** Trashed shots keep their letter in a locked scene, so it isn't given out twice. */
  trashed: boolean;
}

/**
 * The number each live shot in a scene should have, in board order. Only shots whose number changes are returned,
 * so applying the result as updates touches nothing else.
 */
export function shotNumbers(
  sceneNumber: string,
  shots: readonly NumberedShot[],
  { locked, ...options }: LetterOptions & { locked: boolean },
): Map<string, string> {
  const changed = new Map<string, string>();
  const live = shots.filter((shot) => !shot.trashed);
  if (!locked) {
    live.forEach((shot, i) => {
      const number = `${sceneNumber}${letterFor(i, options)}`;
      if (shot.number !== number) changed.set(shot.id, number);
    });
    return changed;
  }
  // Locked: every number stays, even one from before the scene was renumbered. A shot without one takes the letter
  // after the highest ever used under this scene number, trashed shots counted.
  let highest = -1;
  for (const shot of shots) {
    const letters = lettersOf(shot.number, sceneNumber);
    const index = letters === null ? null : letterIndex(letters, options);
    if (index !== null) highest = Math.max(highest, index);
  }
  for (const shot of live) {
    if (shot.number !== '') continue;
    highest += 1;
    changed.set(shot.id, `${sceneNumber}${letterFor(highest, options)}`);
  }
  return changed;
}

/** A scene number's leading digits, or null: "12" → 12, "4A" → 4, "A1" → null. */
function leadingNumber(number: string): number | null {
  const match = /^(\d+)/.exec(number);
  return match ? Number(match[1]) : null;
}

/**
 * The number for a scene added after `before` (null for the first place) and before `after` (null for the end):
 * - at the end, one more than the highest number: after 12, 13;
 * - between two scenes, the one before plus a letter: between 4 and 5, 4A; then 4B;
 * - before the first, A plus its number: before 1, A1.
 * Numbers already taken are skipped.
 */
export function sceneNumberBetween(before: string | null, after: string | null, taken: readonly string[]): string {
  const used = new Set(taken);
  if (after === null) {
    const highest = Math.max(0, ...taken.map(leadingNumber).filter((n): n is number => n !== null));
    return String(highest + 1);
  }
  if (before === null) {
    for (const prefix of WITHOUT_I_O) if (!used.has(`${prefix}${after}`)) return `${prefix}${after}`;
    return `A${after}`;
  }
  // 4 → 4A, 4A → 4B: the next free letter after the one the earlier scene has.
  const base = /^(.*?\d)([A-Z]*)$/.exec(before);
  const stem = base?.[1] ?? before;
  const start = base?.[2] ? (letterIndex(base[2], { skipIO: false }) ?? -1) + 1 : 0;
  for (let i = start; i < start + 26 * 27; i += 1) {
    const candidate = `${stem}${letterFor(i, { skipIO: false })}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${before}A`;
}
