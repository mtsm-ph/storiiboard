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
