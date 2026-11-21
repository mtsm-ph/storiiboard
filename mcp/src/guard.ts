import { contactGuard, contactIn } from '../../src/core/model/assistantView';
import type { Records } from './project';

// The server's last check before an answer leaves (7.5): the answer as it will be sent, searched for every
// contact-shaped value the project holds (assistantView.ts's `contactGuard`: phones by their last 7 digits, emails,
// addresses, coordinates to 3 decimals, a photo's time; both sides normalised). The tools never pick one, by the view;
// this catches a reader that ever handed one through, and refuses the whole answer rather than send it.

/** What a refused answer suggests, by tool: a narrower call shows which item holds the detail. */
const NARROW: Readonly<Record<string, string>> = {
  list_shots: 'Ask for one scene or one shoot day at a time to find the frame that holds it.',
  list_scenes: 'Ask list_shots for one scene at a time instead.',
  get_call_sheet: "Ask for the day's scenes with list_shots, or the locations with list_locations, instead.",
  get_plan: 'Ask for one setup at a time, or for the scene without a setup.',
  list_suggestions: 'Ask for one status at a time (pending, approved or rejected).',
};

const NARROW_OTHER = 'One of its items has a contact detail typed into its text: someone can take it out in Storiiboard.';

/** The refusal's words for a tool. */
export function contactRefused(tool: string): string {
  return `${tool}: this answer was held back, since it would have held a contact detail (a phone number, an email, an address, coordinates or a photo's time), which these tools never return. ${NARROW[tool] ?? NARROW_OTHER}`;
}

/** The answer's text, or a refusal when it holds a contact detail of the project. */
export function checkedAnswer(records: Records, tool: string, answer: unknown): { ok: true; text: string } | { ok: false; text: string } {
  const text = JSON.stringify(answer);
  return contactIn(contactGuard(records), text) === null ? { ok: true, text } : { ok: false, text: contactRefused(tool) };
}
