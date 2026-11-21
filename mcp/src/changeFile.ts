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
  /** `<YYYY-MM-DD HH-mm-ss> <client> <8 hex>.sbdchanges`: never the same twice (the hex is the file id's own). */
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
  const pick = (value: unknown) => (typeof value === 'string' ? cleanText(withoutContacts(value), SUGGESTION_BOUNDS.name) : '');
  return pick(info?.title) || pick(info?.name) || NO_NAME;
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

/** This computer's time, as a backup's name has it, with seconds: `2026-11-21 09-12-05`. */
const stamp = (at: Date) => `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`;

export function changeFileName(at: Date, client: string, id: string): string {
  return `${stamp(at)} ${namePart(client)} ${id.slice(0, 8)}.sbdchanges`;
}

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
    project_name: cleanText(input.projectName, SUGGESTION_BOUNDS.name),
    created_at: createdAt,
    created_by: 'mcp',
    people: [{ id: AUTHOR, name: input.client, role: 'assistant' }],
    suggestions: input.suggestions.map((s) => ({ id: s.id, kind: s.kind, target: s.target, author: AUTHOR, created_at: createdAt, note: s.note, data: s.data })),
  };
  return { id, name: changeFileName(input.at, input.client, id), bytes: new TextEncoder().encode(JSON.stringify(file, null, 2)), count: input.suggestions.length };
}
