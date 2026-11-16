// Fractional sort keys: siblings sort by plain string comparison, and a key can always be made between any two, so
// dropping a frame between 4A and 4B rewrites that frame's row only, never its neighbours or its parent.
// Keys are base-62 digits that never end in "0" (a trailing zero would leave no room below the key).

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function digit(key: string, i: number): number {
  const index = DIGITS.indexOf(key.charAt(i));
  if (index < 0) throw new Error(`"${key}" isn't a sort key.`);
  return index;
}

/** A key strictly between a and b; a may be '' (the start), b undefined (the end). */
function midpoint(a: string, b: string | undefined): string {
  if (b !== undefined) {
    // Skip the shared prefix; the answer starts with it.
    let n = 0;
    while ((a.charAt(n) || '0') === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const low = a === '' ? 0 : digit(a, 0);
  const high = b === undefined ? DIGITS.length : digit(b, 0);
  if (high - low > 1) return DIGITS.charAt(Math.round((low + high) / 2));
  // Adjacent digits: b's first digit alone is above a and below b, when b has more after it.
  if (b !== undefined && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(low) + midpoint(a.slice(1), undefined);
}

/** A sort key after `before` and before `after`; null means the start or the end of the list. */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`Can't place a key between "${before}" and "${after}".`);
  }
  return midpoint(before ?? '', after ?? undefined);
}

// Keys read from the records (6.22, 6.23; Kevin: an unreadable sort key from an odd imported file never makes the app
// throw). A stored key can be any string: keyBetween throws on one it can't read, and on two out of order or tied, and
// for a few odd strings ('', or one ending in "0") makes a key that isn't between them. Every caller that hands it a
// stored key goes through one of these instead; a sound file gets exactly keyBetween's key from each.

/** keyBetween's key when it lies strictly between the two, else null: a key it can't read, two out of order, a tie. */
export function keyBetweenOrNull(before: string | null, after: string | null): string | null {
  try {
    const key = keyBetween(before, after);
    return (before === null || key > before) && (after === null || key < after) ? key : null;
  } catch {
    return null;
  }
}

/** The key after `key`, or null when keyBetween can't read it. */
export const keyAfter = (key: string | null): string | null => keyBetweenOrNull(key, null);

/** The last of these keys that keyBetween can read, in any order given; null with none. */
export function lastReadableKey(keys: Iterable<string>): string | null {
  let readable: string | null = null;
  for (const key of keys) if ((readable === null || key > readable) && keyAfter(key) !== null) readable = key;
  return readable;
}

/**
 * The key after the last of a list (`last`, its greatest stored key): keyBetween(last, null) when it can read it, else
 * after the list's last readable key (`readable`, asked only then, so a sound file reads nothing more), still last among
 * the readable ones while the odd records keep their keys; with none readable, the first key there is.
 */
export function keyAfterStored(last: string | null, readable: () => string | null): string {
  return keyAfter(last) ?? keyAfter(readable()) ?? keyBetween(null, null);
}

/** keyAfterStored for a list of keys already in hand (any order). */
export function keyAfterKeys(keys: readonly string[]): string {
  let last: string | null = null;
  for (const key of keys) if (last === null || key > last) last = key;
  return keyAfterStored(last, () => lastReadableKey(keys));
}

/**
 * A key between two stored keys (6.22): keyBetween's, or, when it can't place one there, the key after `last`, the last
 * readable key of the list, so the edit puts its record last instead of throwing. With `last` unreadable too, the first
 * key there is. For a list it can see whole, placeAmong keeps the order asked for instead.
 */
export function keyBetweenStored(before: string | null, after: string | null, last: string | null): string {
  return keyBetweenOrNull(before, after) ?? keyAfter(last) ?? keyBetween(null, null);
}

/**
 * `count` keys in order for a list written afresh, spread evenly at the shortest length that holds them, so a list of
 * any size gets short keys with room between them all; one is keyBetween(null, null)'s.
 */
export function freshKeys(count: number): string[] {
  let width = 1;
  let span = DIGITS.length;
  while (span < 2 * (count + 1)) {
    width += 1;
    span *= DIGITS.length;
  }
  const keys: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    let value = Math.floor((i * span) / (count + 1));
    let key = '';
    for (let d = 0; d < width; d += 1) {
      key = DIGITS.charAt(value % DIGITS.length) + key;
      value = Math.floor(value / DIGITS.length);
    }
    // A key never ends in "0"; dropping trailing zeros keeps the order, as each key is still above the one before it.
    keys.push(key.replace(/0+$/, ''));
  }
  return keys;
}

/** A record's place in a list: its id and stored key. */
export interface Keyed {
  readonly id: string;
  readonly sortKey: string;
}

/**
 * Fresh keys for a whole list, in the order given (6.23): for when a stored key can't be read or two are out of order,
 * so the edit still gives the order the person asked for. Only the ids whose key changes.
 */
export function sequenceKeys(sequence: readonly Keyed[]): Map<string, string> {
  const fresh = freshKeys(sequence.length);
  const keys = new Map<string, string>();
  sequence.forEach((r, i) => {
    const key = fresh[i] ?? '';
    if (key !== r.sortKey) keys.set(r.id, key);
  });
  return keys;
}

/**
 * Keys for `count` new or moved records put at `at` among `siblings` (in their order, the records moved left out): in a
 * sound list each is keyBetween of the one before and the sibling after, in a chain, and no sibling moves. When the two
 * stored neighbours leave no key between them (one keyBetween can't read, two out of order or tied), the whole list is
 * written afresh in the order shown with the records in place: `moves` holds the siblings' new keys, for the same group.
 */
export function placeAmong(siblings: readonly Keyed[], place: number, count: number): { keys: string[]; moves: Map<string, string> } {
  const at = Math.max(0, Math.min(place, siblings.length));
  const after = siblings[at]?.sortKey ?? null;
  let before = siblings[at - 1]?.sortKey ?? null;
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = keyBetweenOrNull(before, after);
    if (key === null) break;
    keys.push(key);
    before = key;
  }
  if (keys.length === count) return { keys, moves: new Map() };
  const fresh = freshKeys(siblings.length + count);
  const moves = new Map<string, string>();
  siblings.forEach((r, i) => {
    const key = fresh[i < at ? i : i + count] ?? '';
    if (key !== r.sortKey) moves.set(r.id, key);
  });
  return { keys: fresh.slice(at, at + count), moves };
}
