import { withoutContacts } from '../../src/core/model/assistantView';
import type { JsonValue } from '../../src/core/model/record';
import { cleanText, SUGGESTION_BOUNDS } from '../../src/core/model/suggestion';
import { CHANGE_FILE_FORMAT, CHANGE_FILE_VERSION } from '../../src/core/storage/changeFile';

// The change file the assistant's suggestions are written as (7.6, docs/SBD_FORMAT.md "Change files", 7.1's format):
// built here as bytes, pure (no disk), so the end-to-end test brings in exactly what the server writes. One file per
// call, a new id each time (a writer never adds to a file it wrote), `created_by: "mcp"`, and one person: the
// assistant's app by the name it gave itself, with the role `assistant`. changeFolder.ts writes the bytes; propose.ts
// checks them with 7.1's own reader first.

/** One suggestion as the file has it. */
export interface FileSuggestion {
  id: string;
  kind: 'trash' | 'update' | 'create' | 'reorder';
  target: { id?: string; type: string; label: string; updated_at?: string };
  note: string;
  data: { [key: string]: JsonValue };
}

export interface BuiltChangeFile {
  id: string;
  /** `<YYYY-MM-DD HH-mm-ssZ> <client> <8 hex>.sbdchanges`, in UTC: never the same twice (the hex is the file id's own). */
  name: string;
  bytes: Uint8Array;
  count: number;
}

/** The person every suggestion of the file names. */
const AUTHOR = 'a';
/** When the client gives no name it can be known by. */
const NO_NAME = 'MCP client';

/**
 * The client's own name as it gave it in the MCP initialize request (its `title`, else its `name`), as text: controls and
 * format characters out, a contact detail taken out, at most a person's name's 100 characters.
 */
export function clientName(info: { name?: unknown; title?: unknown } | undefined): string {
  const pick = (value: unknown) => (typeof value === 'string' ? nameText(withoutContacts(value)) : '');
  return pick(info?.title) || pick(info?.name) || NO_NAME;
}

/**
 * A name as the file holds it (round 6): cleanText, then at most SUGGESTION_BOUNDS.name UTF-16 units, as 7.1's reader
 * counts a name's length; cleanText counts characters, so a name of 100 emoji would be 200 units and refused. Never half
 * a surrogate pair.
 */
export function nameText(value: string): string {
  const max = SUGGESTION_BOUNDS.name;
  const clean = cleanText(value, max);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const last = cut.charCodeAt(max - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trim();
}

/** The client's name as a file name's part: letters, digits, spaces, dots, dashes and underscores, at most 40. */
function namePart(client: string): string {
  const kept = client
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
  return Array.from(kept).slice(0, 40).join('').replace(/[ .]+$/, '') || 'assistant';
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The time in UTC, with seconds and a Z: `2026-11-21 21-04-09Z` (round 2). Never this computer's zone: the name goes
 * wherever the folder syncs, and the zone would say where the computer is.
 */
const stamp = (at: Date) =>
  `${String(at.getUTCFullYear())}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())} ${two(at.getUTCHours())}-${two(at.getUTCMinutes())}-${two(at.getUTCSeconds())}Z`;

export function changeFileName(at: Date, client: string, id: string): string {
  return `${stamp(at)} ${namePart(client)} ${id.slice(0, 8)}.sbdchanges`;
}

/**
 * The temporary name changeFolder.ts writes a change file under, as it makes one: `.<file name>.<8 hex>.writing`. Only
 * names of exactly this shape are ever taken away as the server's own leftovers (round 2).
 */
export const WRITING_NAME = /^\.\d{4}-\d\d-\d\d \d\d-\d\d-\d\dZ [\p{L}\p{N} ._-]{1,40} [0-9a-f]{8}\.sbdchanges\.[0-9a-f]{8}\.writing$/u;

export interface ChangeFileInput {
  projectId: string;
  projectName: string;
  client: string;
  suggestions: readonly FileSuggestion[];
  at: Date;
  /** The file's id; a new one when left out. */
  id?: string;
}

/** The file as bytes, its id and its name. */
export function buildChangeFile(input: ChangeFileInput): BuiltChangeFile {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = input.at.toISOString();
  const file = {
    format: CHANGE_FILE_FORMAT,
    version: CHANGE_FILE_VERSION,
    id,
    project_id: input.projectId,
    project_name: nameText(input.projectName),
    created_at: createdAt,
    created_by: 'mcp',
    people: [{ id: AUTHOR, name: input.client, role: 'assistant' }],
    suggestions: input.suggestions.map((s) => ({ id: s.id, kind: s.kind, target: s.target, author: AUTHOR, created_at: createdAt, note: s.note, data: s.data })),
  };
  return { id, name: changeFileName(input.at, input.client, id), bytes: new TextEncoder().encode(JSON.stringify(file, null, 2)), count: input.suggestions.length };
}
