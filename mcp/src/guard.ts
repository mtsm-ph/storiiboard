import { contactValues } from '../../src/core/model/assistantView';
import type { Records } from './project';

// The server's last check before an answer leaves (7.5): the answer as it will be sent, searched for every contact
// detail the project holds (assistantView.ts's `contactValues`: phones, emails, addresses, parking, coordinates, a
// photo's place and time). The tools never pick one, by the view; this catches a reader that ever handed one through,
// and refuses the whole answer rather than send it.

export const CONTACT_REFUSED = 'This answer was held back: it would have held contact details, which these tools never return.';

/** The answer's text, or a refusal when it holds a contact detail of the project. */
export function checkedAnswer(records: Records, answer: unknown): { ok: true; text: string } | { ok: false; text: string } {
  const text = JSON.stringify(answer);
  // Searched both as written and as JSON writes a string (quotes and backslashes escaped).
  const found = contactValues(records).some((value) => text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1)));
  return found ? { ok: false, text: CONTACT_REFUSED } : { ok: true, text };
}
