import { contactGuard, isUuid, TAKEN_OUT, withoutStoredContacts, type ContactGuard } from '../../src/core/model/assistantView';
import type { Records } from './project';

// The server's last check before an answer leaves (7.5): every contact-shaped value the project holds (assistantView.ts's
// `contactGuard`: stored phones by their last 7 digits, emails, whole addresses, coordinates to 4 places; both sides
// normalised), looked for in the answer's typed text and replaced with "[contact left out]", as the free-text rule
// does. The tools never pick a contact prop, by the view; this catches one typed again in a frame's action, a note or a
// title in a form the free-text rule can't recognise.
//
// Round 3: it never refuses an answer (a refused answer is worse than useless on a shoot, and the stored props are
// already left out), and it never reads a key or a number.
//
// Round 4: what it skips, by the key a string sits under.
// - Slate and scene numbers (`number`, `scene`): skipped.
// - Names the view gives (`name`, `label`, `company`, `cast`, `characters`, `plays`, `file_name`): stored phones and
//   emails are still looked for; only addresses and coordinates are skipped (a place named as its address begins).
// - Ids (`id`, `*_id`, `*_ids`): skipped only when the value is a canonical UUID.
// - None of it inside a suggestion's `data`, its `target.label` or its `author.name`: they come from a change file,
//   which anyone could have written.
// Past the depth limit a value is replaced, never returned unchecked.

/** Keys whose strings are slate or scene numbers. */
const NUMBERS = new Set(['number', 'scene']);
/** Keys whose strings are names the view gives. */
const NAMES = new Set(['name', 'label', 'company', 'cast', 'characters', 'plays', 'file_name']);
/** How deep an answer is read; anything deeper is replaced whole. */
const DEPTH = 32;

interface At {
  /** The key the value sits under (an array's items read as their array's key). */
  key: string | null;
  /** Inside what a change file wrote: no key is skipped. */
  untrusted: boolean;
  /** Inside a list of suggestions. */
  inSuggestions: boolean;
}

/** A string with the guard's values replaced, as the key it sits under says. */
function checked(guard: ContactGuard, value: string, at: At): string {
  const { key } = at;
  if (at.untrusted || key === null) return withoutStoredContacts(guard, value);
  if (NUMBERS.has(key)) return value;
  if (key === 'id' || /_ids?$/.test(key)) return isUuid(value) ? value : withoutStoredContacts(guard, value);
  if (NAMES.has(key)) return withoutStoredContacts(guard, value, { name: true });
  return withoutStoredContacts(guard, value);
}

/** A value with the guard's values replaced in its strings. */
function guarded(guard: ContactGuard, value: unknown, at: At, depth: number): unknown {
  if (depth > DEPTH) return TAKEN_OUT;
  if (typeof value === 'string') return checked(guard, value, at);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((inner) => guarded(guard, inner, at, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      const fromFile = at.inSuggestions && (key === 'data' || (at.key === 'target' && key === 'label') || (at.key === 'author' && key === 'name'));
      const next: At = { key, untrusted: at.untrusted || fromFile, inSuggestions: at.inSuggestions || key === 'suggestions' };
      return [key, guarded(guard, inner, next, depth + 1)];
    }),
  );
}

/** The answer as it leaves: the project's stored contact values replaced wherever they were typed again. */
export function guardedAnswer(records: Records, answer: unknown): unknown {
  return guarded(contactGuard(records), answer, { key: null, untrusted: false, inSuggestions: false }, 0);
}
