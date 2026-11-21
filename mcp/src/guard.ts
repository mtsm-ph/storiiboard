import { contactGuard, withoutStoredContacts, type ContactGuard } from '../../src/core/model/assistantView';
import type { Records } from './project';

// The server's last check before an answer leaves (7.5): every contact-shaped value the project holds (assistantView.ts's
// `contactGuard`: stored phones by their last 7 digits, emails, whole addresses, coordinates to 4 places; both sides
// normalised), looked for in the answer's typed text and replaced with "[contact left out]", as the free-text rule
// does. The tools never pick a contact prop, by the view; this catches one typed again in a frame's action, a note or a
// title in a form the free-text rule can't recognise.
//
// Round 3: it never refuses an answer (a refused answer is worse than useless on a shoot, and the stored props are
// already left out), and it reads only strings that hold typed text: never a key, an id, a number, a date, a slate
// number, nor a name the view gives (a person's, a location's, a scene's, a company's, a room's, a character's).

/** Keys whose strings aren't typed text: ids, slate and scene numbers, labels and names. */
const NOT_TEXT = new Set(['id', 'number', 'label', 'name', 'company', 'file_name', 'scene', 'cast', 'characters', 'plays']);

const notText = (key: string | null) => key !== null && (NOT_TEXT.has(key) || /_ids?$/.test(key));

/** A value with the guard's values replaced in its typed text; an array's items read as their array's key. */
function guarded(guard: ContactGuard, value: unknown, key: string | null, depth: number): unknown {
  if (typeof value === 'string') return notText(key) ? value : withoutStoredContacts(guard, value);
  if (depth > 32 || typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((inner) => guarded(guard, inner, key, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([inner, v]) => [inner, guarded(guard, v, inner, depth + 1)]));
}

/** The answer as it leaves: the project's stored contact values replaced wherever they were typed again. */
export function guardedAnswer(records: Records, answer: unknown): unknown {
  return guarded(contactGuard(records), answer, null, 0);
}
