import { contactGuard, withoutContacts, withoutStoredContacts, type ContactGuard } from '../../src/core/model/assistantView';
import { dayCallsheet } from '../../src/core/model/callsheet';
import { gearFields, gearIdsOf, projectGear } from '../../src/core/model/gear';
import { locationFields, projectLocations } from '../../src/core/model/location';
import { personFields, projectPeople } from '../../src/core/model/person';
import type { JsonValue, SbdRecord } from '../../src/core/model/record';
import { dayLabel, type ShootDay } from '../../src/core/model/shootDay';
import { sceneFields, sceneLabel, shotFields } from '../../src/core/model/storyboard';
import { cleanText, lastWritten, MAX_FIELDS, reviewFlagWords, reviewSuggestion, scopeRowFor, seen, SUGGESTION_BOUNDS, type SuggestionFlag } from '../../src/core/model/suggestion';
import { ID_CHARS, scopeField, scopeType, SHORT_VALUE, type StoredBound } from '../../src/core/model/suggestionScope';
import { boardScene } from '../../src/core/ops/storyboardEdits';
import { MAX_CHANGE_FILE_BYTES, readChangeFile, refusalWords } from '../../src/core/storage/changeFile';
import { buildChangeFile, type BuiltChangeFile, type FileSuggestion } from './changeFile';
import { boardScenes, dayOf, read, sceneByNumber, ToolError, type Read, type ToolContext } from './tools';

// The propose tools (7.6, Phase 7 decisions 3, 4 and 16): each turns plain arguments (a scene number, a frame number, a
// day by date or number, field values as the app's own) into 7.0's suggestions, their `before` values from the project
// as read, and checks them before anything is written: every suggestion through 7.0's reader under the assistant's
// scope row (reviewSuggestion, as the review screen will read it), and the whole file through 7.1's reader, the very
// bytes that will be written. Anything refused is said in words at once and nothing is written, so the assistant
// learns. Pure: the server's write is changeFolder.ts's alone.
//
// Round 2, no contact oracle: the bounds come first (MAX_PER_CALL suggestions, MAX_FIELDS fields of at most
// MAX_KEY-character names and MAX_VALUE-character values, the whole call at most 256 KB in server.ts), then the scope
// row and the fields, and only then any look for a contact. A call is refused for a contact only by the free-text rule
// (what the assistant's own text shows: a phone number, an email, coordinates, a map link). No answer repeats a value
// the assistant gave: it says what was written by counts and by labels from the project's own records.
//
// Round 3: nothing the assistant sends is matched against the values the project stores. The guard keeps stored
// contacts out of what goes to the assistant; whatever it sends it holds already, so matching it protects nothing, and
// any trace of the match (a bound crossed after a replacement, a marker read back later) would say which guess was
// stored. The file holds exactly what was sent, after the bounds, the scope and the free-text rule: one build, one
// read, one answer, whatever the values. A name looked up (a location, gear, a person) is compared with each record's
// name through the free-text rule, and one that rule would change is refused before any record is looked at.
// Refusals: words made from records go through the view and the guard (`recordWords`); words that repeat the
// assistant's own arguments ("There's no frame numbered "99Z"") are a function of those arguments alone, so they say
// nothing of what is stored, and stay as they are.
//
// Round 4, the rule everywhere: no answer, refusal, count or later listing depends on comparing what the assistant sent
// with a value it can't see. A check may compare with what the read tools show it (the view and the guard), never with
// the hidden stored text. So "nothing to change" is no refusal (the review screen says so, and Apply only marks it
// applied); the free-text rule and the scope row run before anything is built or compared with the project; a name is
// looked up as list_gear, list_people and list_locations give it, guard included; and `before` holds only fields of the
// scope row, so a hidden field's length never decides a bound.
//
// Round 5, sizes and timing too: every size the file is checked for (one suggestion's 256 KB, the file's 5 MB, a
// string's 10,000 characters) is decided before the build, from what was sent and a fixed reserve for each `before`
// value: the largest its field's row bound lets it be, as UTF-8 JSON at its worst (`stored` in the scope row). The
// checks of the row that read no records (lengths, choices, ranges: `shape`) run then too. A stored value already past
// its bound is refused in fixed words, whatever was sent. The real file can only be smaller than the reserves allowed,
// and 7.1's reader is asserted to pass it. A call sheet's map holds in `before` only the keys named, as the sheet reads
// them (the review's own `seen`), so its reserve is a function of the keys sent. The review then works out flags alone
// (ReviewMode `flags`): no edit, so its work never depends on whether a value equals the stored one.

type Obj = { [key: string]: JsonValue };

/** What one call proposes: the file's suggestions, each said in a line for the answer. */
export interface Proposal {
  suggestions: FileSuggestion[];
  lines: string[];
}

/** Most suggestions one call makes (frames added, changed, moved or trashed, and a new scene). */
export const MAX_PER_CALL = 200;
/** Longest name of a field. */
export const MAX_KEY = 100;
/** Longest value of a field, in characters (as JSON, for a value that isn't text). */
export const MAX_VALUE = 10_000;
/** How deep a value is read; deeper is refused. */
const MAX_DEPTH = 16;
/** Most people one call gives times for. */
const MAX_PEOPLE = 200;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value from the call as JSON: it came as JSON, but a value is never trusted to be one. */
function jsonOf(value: unknown, field: string, depth = 0): JsonValue {
  if (depth > MAX_DEPTH) throw new ToolError(`${field} isn't a value it takes.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ToolError(`${field} isn't a number it takes.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((inner) => jsonOf(inner, field, depth + 1));
  if (isObject(value)) {
    const out: Obj = {};
    for (const [key, inner] of Object.entries(value)) Object.defineProperty(out, key, { value: jsonOf(inner, field, depth + 1), enumerable: true, writable: true, configurable: true });
    return out;
  }
  throw new ToolError(`${field} isn't a value it takes.`);
}

/** A value's length as the bounds count it: a text's characters, anything else's JSON. Never more than the bound reads. */
function valueLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  try {
    // Undefined for a value JSON has no text for (undefined itself), whatever the type says.
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? 0 : text.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * A map of named values checked against the bounds before anything in it is read (round 2): an object, at most `most`
 * names of at most MAX_KEY characters, each value at most MAX_VALUE characters.
 */
function bounded(given: unknown, what: string, most = MAX_FIELDS): Record<string, unknown> {
  if (!isObject(given)) throw new ToolError(`${what}: fields are named values ({ "size": "CU", "lens_mm": 85 }).`);
  const keys = Object.keys(given);
  if (keys.length > most) throw new ToolError(`${what}: at most ${String(most)} fields at a time.`);
  for (const key of keys) {
    if (key.length > MAX_KEY) throw new ToolError(`${what}: a field's name is at most ${String(MAX_KEY)} characters.`);
    if (valueLength(given[key]) > MAX_VALUE) throw new ToolError(`${what}: a field's value is at most ${String(MAX_VALUE).replace(/\B(?=(\d{3})+$)/g, ',')} characters.`);
  }
  return given;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the refusals say a contact detail reads as. */
const CONTACT_WORDS = 'what reads as a phone number, an email, an address, coordinates or a map link';

/** Whether a text shows a contact detail by the free-text rule alone: what the assistant's own text shows. */
const showsContact = (text: string): boolean => withoutContacts(text) !== text;

/**
 * Words made from the project's records (a gear item's name) for a refusal, as an answer's would be (round 3): through
 * the view's free-text rule, then the guard, as a name. A refusal leaves without the server's guard (server.ts), so it
 * is applied here.
 */
function recordWords(r: Read, text: string, guard: ContactGuard = contactGuard(r.data.records)): string {
  return withoutStoredContacts(guard, withoutContacts(text), { name: true });
}

/**
 * A live record by its id, else by its name; never a guess between two of one name (round 2). The refusals name only
 * what the project holds, never the value the assistant gave. Round 3: a name the free-text rule would change is
 * refused without a look at any record (a function of the name alone). Round 4: each record's name is compared as the
 * list tools give it (`recordWords`: the free-text rule, then the guard), never as stored, so a phone typed in a record's
 * name can't be confirmed by guessing it, whether the free-text rule or the guard hides it; the value given is never put
 * through the guard itself.
 */
function oneOf<T extends { record: SbdRecord }>(
  r: Read,
  live: readonly T[],
  value: string,
  nameOf: (item: T) => string,
  words: { none: string; contact: string; two: (name: string, count: number) => string },
): string {
  if (showsContact(value)) throw new ToolError(words.contact);
  const byId = live.find((item) => item.record.id === value);
  if (byId) return byId.record.id;
  const guard = contactGuard(r.data.records);
  const named = live.filter((item) => sameText(recordWords(r, nameOf(item), guard), value));
  const [first] = named;
  if (!first) throw new ToolError(words.none);
  if (named.length > 1) throw new ToolError(words.two(recordWords(r, nameOf(first), guard).trim(), named.length));
  return first.record.id;
}

/** A name to look up that holds what reads as a contact: refused, never said back. */
const contactName = (what: string, list: string) => `A name to look up can't hold ${CONTACT_WORDS}: give the ${what}'s id (${list}).`;

const howMany = (count: number) => (count === 2 ? 'Two' : String(count));

/** A frame's label as a person sees it on the board: "SC 12 · 12A". */
const frameLabel = (scene: SbdRecord, shot: SbdRecord) => `${sceneLabel(sceneFields(scene.props).number)} · ${shotFields(shot.props).number}`;
const sceneWords = (scene: SbdRecord) => sceneLabel(sceneFields(scene.props).number);

/** A live frame by its number ("12A"), in a scene when one is named; never a guess between two. */
function frameByNumber(r: Read, number: string, scene?: SbdRecord): { shot: SbdRecord; scene: SbdRecord } {
  const wanted = number.trim().toUpperCase();
  const scenes = scene ? [scene] : boardScenes(r, false);
  const found = scenes.flatMap((s) =>
    Object.values(r.scoped)
      .filter((f) => f.type === 'shot' && f.parentId === s.id && f.trashedAt === null && shotFields(f.props).number.toUpperCase() === wanted)
      .map((shot) => ({ shot, scene: s })),
  );
  const [first] = found;
  // The assistant's own argument said back (round 3): a function of what it sent alone, whatever the project stores.
  if (!first) throw new ToolError(`There's no frame numbered "${number}"${scene ? ` in ${sceneWords(scene)}` : ''}. list_shots lists them.`);
  if (found.length > 1) throw new ToolError(`More than one frame is numbered "${number}": name its scene too.`);
  return first;
}

/** A scene's live notes in board order, counted from 1, as the board shows them among its frames. */
function noteOf(r: Read, scene: SbdRecord, n: number): SbdRecord {
  const notes = boardScene(r.scoped, scene).items.flatMap((item) => (item.kind === 'note' ? [item.note.record] : []));
  const note = notes[n - 1];
  if (!note) throw new ToolError(`${sceneWords(scene)} has ${notes.length === 0 ? 'no notes' : `${String(notes.length)} note${notes.length === 1 ? '' : 's'}`}: there's no note ${String(n)}.`);
  return note;
}

/** A live location by its id or its name. */
function locationOf(r: Read, value: string): string {
  return oneOf(r, projectLocations(r.scoped, r.projectId), value, (l) => locationFields(l.record.props).name, {
    none: "There's no location of that name. list_locations lists them.",
    contact: contactName('location', 'list_locations lists them'),
    two: (name, count) => `${howMany(count)} locations are named "${name}": give its id (list_locations lists them).`,
  });
}

/** A live gear item of the catalogue by its id or its name. */
function gearOf(r: Read, value: string): string {
  return oneOf(r, projectGear(r.scoped, r.projectId), value, (g) => gearFields(g.record.props).name, {
    none: "There's no gear item of that name in the catalogue. list_gear lists it.",
    contact: contactName('gear item', 'list_gear lists them'),
    two: (name, count) => `${howMany(count)} gear items are named "${name}": give its id (list_gear lists them).`,
  });
}

/** A live person by id or name. */
function personOf(r: Read, value: string): string {
  return oneOf(r, projectPeople(r.scoped, r.projectId), value, (p) => personFields(p.record.props).name, {
    none: "There's no one of that name in Cast and crew. list_people lists them.",
    contact: contactName('person', 'list_people lists them'),
    two: (name, count) => `${howMany(count)} people are named "${name}": give their id (list_people lists them).`,
  });
}

/** The names the tools take for a field, besides its own: a location, a day and gear by what a person calls them. */
const ALIASES: Readonly<Record<string, string>> = { location: 'location_id', shoot_day: 'shoot_day_id', gear: 'gear_ids' };

/**
 * A frame's or a scene's fields as the call gave them, its plain values made the app's own: a location by name, a shoot
 * day by its date or number, gear by name. A field the scope row doesn't have stays as named, so 7.0's reader refuses it.
 */
function fieldsOf(r: Read, given: unknown, what: string): Obj {
  const out: Obj = {};
  for (const [name, raw] of Object.entries(bounded(given, what))) {
    const field = Object.hasOwn(ALIASES, name) ? (ALIASES[name] ?? name) : name;
    let value = jsonOf(raw, field);
    if (field === 'location_id' && typeof value === 'string') value = locationOf(r, value);
    if (field === 'shoot_day_id' && typeof value === 'string') value = Object.hasOwn(r.scoped, value) && r.scoped[value]?.type === 'shoot_day' ? value : dayOf(r, value).record.id;
    if (field === 'gear_ids' && Array.isArray(value)) value = value.map((v) => (typeof v === 'string' ? gearOf(r, v) : v));
    Object.defineProperty(out, field, { value, enumerable: true, writable: true, configurable: true });
  }
  if (Object.keys(out).length === 0) throw new ToolError(`${what}: name at least one field.`);
  return out;
}

/**
 * What the project holds for each named field, as the suggester saw it: its `before`. Round 4: only fields of the scope
 * row for `type` (a field outside it is refused before anything is built), so a hidden field's stored value, and its
 * length, never reaches the file or a bound. Round 5: a call sheet's map (`by_key`) only for the keys named, as the
 * sheet reads them (the review's `seen`, which compares nothing else), so its size is a function of the keys sent.
 */
function beforeOf(r: Read, type: string, record: SbdRecord | null, fields: Obj): Obj {
  const out: Obj = {};
  const entry = scopeType(scopeRowFor(), type);
  for (const [field, named] of Object.entries(fields)) {
    const rule = entry ? scopeField(entry, field) : null;
    if (!rule) continue;
    const stored = record?.props[field];
    // A map that isn't one is refused by its shape before the build; its before is never the stored map whole.
    const value = rule.stored.kind !== 'by_key' ? (stored ?? null) : isObject(named) ? seen(r.data.records, field, rule, stored, named) : {};
    Object.defineProperty(out, field, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

const fieldCount = (props: Obj) => {
  const n = Object.keys(props).length;
  return `${String(n)} field${n === 1 ? '' : 's'}`;
};

const note = (value: string | undefined): string => value ?? '';

const newId = () => crypto.randomUUID();

// -- suggest_shot_changes ----------------------------------------------------------------------------------------------

export interface ShotChangesArgs {
  changes: { frame: string; scene?: string | undefined; fields: Record<string, unknown> }[];
  note?: string | undefined;
}

export function suggestShotChanges(context: ToolContext, args: ShotChangesArgs): Proposal {
  const r = read(context);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  for (const change of args.changes) {
    const { shot, scene } = frameByNumber(r, change.frame, change.scene === undefined ? undefined : sceneByNumber(r, change.scene));
    const label = frameLabel(scene, shot);
    const props = fieldsOf(r, change.fields, label);
    suggestions.push({ id: newId(), kind: 'update', target: { id: shot.id, type: 'shot', label, updated_at: shot.updatedAt }, note: note(args.note), data: { props, before: beforeOf(r, 'shot', shot, props) } });
    lines.push(`Change ${label}: ${fieldCount(props)}.`);
  }
  return { suggestions, lines };
}

// -- suggest_new_shots -------------------------------------------------------------------------------------------------

export interface NewShotsArgs {
  scene?: string | undefined;
  new_scene?: Record<string, unknown> | undefined;
  after?: string | undefined;
  frames: Record<string, unknown>[];
  note?: string | undefined;
}

export function suggestNewShots(context: ToolContext, args: NewShotsArgs): Proposal {
  const r = read(context);
  if ((args.scene === undefined) === (args.new_scene === undefined)) throw new ToolError('suggest_new_shots: name an existing scene (scene) or describe a new one (new_scene), not both.');
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  let parentId: string;
  let afterId: string | null;
  let where: string;
  if (args.new_scene !== undefined) {
    const { after, ...fields } = bounded(args.new_scene, 'new_scene', MAX_FIELDS + 1);
    // After the scene named, else at the end of the board, as + Add Scene puts one; first on a board with none.
    const live = boardScenes(r, false);
    const afterScene = typeof after === 'string' ? sceneByNumber(r, after) : (live.at(-1) ?? null);
    if (after !== undefined && typeof after !== 'string') throw new ToolError('new_scene.after is a scene number as text ("12").');
    const props = fieldsOf(r, fields, 'new_scene');
    const id = newId();
    const label = afterScene ? `New scene after ${sceneWords(afterScene)}` : 'New scene';
    suggestions.push({ id, kind: 'create', target: { type: 'scene', label }, note: note(args.note), data: { type: 'scene', parent_id: r.projectId, after_id: afterScene?.id ?? null, props } });
    lines.push(`Add a scene${afterScene ? ` after ${sceneWords(afterScene)}` : ''}: ${fieldCount(props)}.`);
    if (args.after !== undefined) throw new ToolError('suggest_new_shots: after places frames among a scene’s own; a new scene’s frames go in the order given.');
    parentId = id;
    afterId = null;
    where = 'the new scene';
  } else {
    const scene = sceneByNumber(r, args.scene ?? '');
    const items = boardScene(r.scoped, scene).items;
    parentId = scene.id;
    if (args.after === undefined) {
      const last = items.at(-1);
      afterId = last ? (last.kind === 'shot' ? last.shot.record.id : last.note.record.id) : null;
    } else if (args.after.trim().toLowerCase() === 'start') afterId = null;
    else afterId = frameByNumber(r, args.after, scene).shot.id;
    where = sceneWords(scene);
  }
  if (args.frames.length === 0 && args.new_scene === undefined) throw new ToolError('suggest_new_shots: give at least one frame.');
  args.frames.forEach((frame, i) => {
    const props = fieldsOf(r, frame, `frame ${String(i + 1)}`);
    const id = newId();
    suggestions.push({ id, kind: 'create', target: { type: 'shot', label: `New frame ${String(i + 1)} in ${where}` }, note: note(args.note), data: { type: 'shot', parent_id: parentId, after_id: afterId, props } });
    lines.push(`Add a frame in ${where}: ${fieldCount(props)}.`);
    // Each after the one before it, so the frames keep the order given (7.0: an after_id may name a create of the file).
    afterId = id;
  });
  return { suggestions, lines };
}

// -- suggest_reorder ---------------------------------------------------------------------------------------------------

export interface ReorderArgs {
  moves: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined; to_scene?: string | undefined; after?: string | undefined; after_note?: number | undefined }[];
  note?: string | undefined;
}

/** A frame (by number, in a scene when named) or a scene's note (by its number in the scene). */
function itemOf(r: Read, item: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined }, what: string): { record: SbdRecord; scene: SbdRecord; label: string } {
  if (item.frame !== undefined) {
    const { shot, scene } = frameByNumber(r, item.frame, item.scene === undefined ? undefined : sceneByNumber(r, item.scene));
    return { record: shot, scene, label: frameLabel(scene, shot) };
  }
  if (item.note !== undefined && item.scene !== undefined) {
    const scene = sceneByNumber(r, item.scene);
    return { record: noteOf(r, scene, item.note), scene, label: `${sceneWords(scene)} · note ${String(item.note)}` };
  }
  throw new ToolError(`${what}: name a frame by its number, or a note by its scene and its number in the scene.`);
}

export function suggestReorder(context: ToolContext, args: ReorderArgs): Proposal {
  const r = read(context);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  args.moves.forEach((move, i) => {
    const what = `move ${String(i + 1)}`;
    const item = itemOf(r, move, what);
    const to = move.to_scene === undefined ? item.scene : sceneByNumber(r, move.to_scene);
    let afterId: string | null;
    let after: string;
    if (move.after_note !== undefined) {
      afterId = noteOf(r, to, move.after_note).id;
      after = `after note ${String(move.after_note)}`;
    } else if (move.after === undefined) {
      throw new ToolError(`${what}: give after (a frame number, or "start") or after_note (a note’s number in the scene).`);
    } else if (move.after.trim().toLowerCase() === 'start') {
      afterId = null;
      after = 'to the start';
    } else {
      const frame = frameByNumber(r, move.after, to).shot;
      afterId = frame.id;
      // The frame's number as the project has it, never as the call wrote it.
      after = `after ${shotFields(frame.props).number}`;
    }
    suggestions.push({
      id: newId(),
      kind: 'reorder',
      target: { id: item.record.id, type: item.record.type, label: item.label, updated_at: lastWritten(r.data.records, item.record) },
      note: note(args.note),
      data: { parent_id: to.id, after_id: afterId },
    });
    lines.push(`Move ${item.label} ${after}${to.id === item.scene.id ? '' : ` in ${sceneWords(to)}`}.`);
  });
  return { suggestions, lines };
}

// -- suggest_gear_for_day ----------------------------------------------------------------------------------------------

export interface GearForDayArgs {
  day: string;
  add?: string[] | undefined;
  remove?: string[] | undefined;
  note?: string | undefined;
}

export function suggestGearForDay(context: ToolContext, args: GearForDayArgs): Proposal {
  const r = read(context);
  const day = dayOf(r, args.day);
  const adds = (args.add ?? []).map((g) => gearOf(r, g));
  const removes = (args.remove ?? []).map((g) => gearOf(r, g));
  if (adds.length === 0 && removes.length === 0) throw new ToolError('suggest_gear_for_day: name gear to add or to remove.');
  const stored = Array.isArray(day.record.props.gear_ids) ? day.record.props.gear_ids : [];
  // The list a person would end with: what they can see on it (live items), less those taken off, then those added at
  // the end, as the Gear picker puts them. What they can't see stays where it is (7.0's own edit keeps it). Live is
  // judged on the full records (round 2): an item of a department the view hides is still on the list.
  const live = gearIdsOf(day.record.props).filter((id) => {
    const item = Object.hasOwn(r.data.records, id) ? r.data.records[id] : undefined;
    return item !== undefined && item.trashedAt === null && item.type === 'gear_item';
  });
  const dayName = dayLabel(day);
  for (const id of removes) if (!live.includes(id)) throw new ToolError(`${recordWords(r, gearFields(r.scoped[id]?.props ?? {}).name)} isn't on ${dayName}’s list.`);
  const wanted = [...live.filter((id) => !removes.includes(id)), ...adds.filter((id, i) => !live.includes(id) && adds.indexOf(id) === i)];
  const label = dayName;
  const props: Obj = { gear_ids: wanted };
  const names = (ids: string[]) => ids.map((id) => gearFields(r.scoped[id]?.props ?? {}).name).join(', ');
  return {
    suggestions: [{ id: newId(), kind: 'update', target: { id: day.record.id, type: 'shoot_day', label, updated_at: day.record.updatedAt }, note: note(args.note), data: { props, before: { gear_ids: stored } } }],
    lines: [`${dayName}’s gear list${adds.length > 0 ? `: add ${names(adds)}` : ''}${removes.length > 0 ? `${adds.length > 0 ? ';' : ':'} take off ${names(removes)}` : ''}.`],
  };
}

// -- suggest_call_sheet_notes ------------------------------------------------------------------------------------------

export interface CallSheetArgs {
  day: string;
  notes?: string | null | undefined;
  safety_notes?: string | null | undefined;
  call_time?: string | null | undefined;
  wrap_time?: string | null | undefined;
  department_calls?: Record<string, string | null> | undefined;
  person_times?: Record<string, { call?: string | null | undefined; hmu_ready?: string | null | undefined; on_set?: string | null | undefined } | null> | undefined;
  note?: string | undefined;
}

export function suggestCallSheetNotes(context: ToolContext, args: CallSheetArgs): Proposal {
  const r = read(context);
  const day: ShootDay = dayOf(r, args.day);
  const dayName = dayLabel(day);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  const sheet = dayCallsheet(r.scoped, day.record.id);
  const props: Obj = {};
  const set = (field: string, value: JsonValue) => Object.defineProperty(props, field, { value, enumerable: true, writable: true, configurable: true });
  if (args.notes !== undefined) set('notes', args.notes);
  if (args.safety_notes !== undefined) set('safety_notes', args.safety_notes);
  if (args.department_calls !== undefined) set('department_calls', jsonOf(bounded(args.department_calls, 'department_calls'), 'department_calls'));
  if (args.person_times !== undefined) {
    const times: Obj = {};
    for (const [who, value] of Object.entries(bounded(args.person_times, 'person_times', MAX_PEOPLE))) Object.defineProperty(times, personOf(r, who), { value: jsonOf(value, 'person_times'), enumerable: true, writable: true, configurable: true });
    set('person_times', times);
  }
  if (Object.keys(props).length > 0) {
    const label = `Call sheet, ${dayName}`;
    suggestions.push({ id: newId(), kind: 'update', target: { id: day.record.id, type: 'callsheet', label, updated_at: (sheet ?? day.record).updatedAt }, note: note(args.note), data: { props, before: beforeOf(r, 'callsheet', sheet, props) } });
    lines.push(`Change the call sheet for ${dayName}: ${Object.keys(props).join(', ')}.`);
  }
  const dayProps: Obj = {};
  if (args.call_time !== undefined) Object.defineProperty(dayProps, 'call_time', { value: args.call_time, enumerable: true, writable: true, configurable: true });
  if (args.wrap_time !== undefined) Object.defineProperty(dayProps, 'wrap_time', { value: args.wrap_time, enumerable: true, writable: true, configurable: true });
  if (Object.keys(dayProps).length > 0) {
    suggestions.push({ id: newId(), kind: 'update', target: { id: day.record.id, type: 'shoot_day', label: dayName, updated_at: day.record.updatedAt }, note: note(args.note), data: { props: dayProps, before: beforeOf(r, 'shoot_day', day.record, dayProps) } });
    lines.push(`Change ${dayName}’s ${Object.keys(dayProps).map((f) => (f === 'call_time' ? 'crew call' : 'wrap')).join(' and ')}.`);
  }
  if (suggestions.length === 0) throw new ToolError('suggest_call_sheet_notes: name notes, safety_notes, call_time, wrap_time, department_calls or person_times.');
  return { suggestions, lines };
}

// -- suggest_trash -----------------------------------------------------------------------------------------------------

export interface TrashArgs {
  items: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined }[];
  note?: string | undefined;
}

export function suggestTrash(context: ToolContext, args: TrashArgs): Proposal {
  const r = read(context);
  const suggestions: FileSuggestion[] = [];
  const lines: string[] = [];
  args.items.forEach((item, i) => {
    let target: { record: SbdRecord; label: string };
    if (item.frame === undefined && item.note === undefined && item.scene !== undefined) {
      const scene = sceneByNumber(r, item.scene);
      target = { record: scene, label: sceneWords(scene) };
    } else target = itemOf(r, item, `item ${String(i + 1)}`);
    suggestions.push({
      id: newId(),
      kind: 'trash',
      target: { id: target.record.id, type: target.record.type, label: target.label, updated_at: lastWritten(r.data.records, target.record) },
      note: note(args.note),
      data: {},
    });
    lines.push(`Move ${target.label} to the Trash.`);
  });
  return { suggestions, lines };
}

// -- the checks before anything is written -----------------------------------------------------------------------------

/** Every string in a value, however deep. */
function strings(value: JsonValue, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const inner of value) strings(inner, out);
  else if (value !== null && typeof value === 'object') for (const inner of Object.values(value)) strings(inner, out);
  return out;
}

/** A suggestion's fields, as named values. */
const fieldsIn = (s: FileSuggestion): [string, JsonValue][] => {
  const props = s.data.props;
  return props !== undefined && props !== null && typeof props === 'object' && !Array.isArray(props) ? Object.entries(props) : [];
};

/** A flag refuses a suggestion unless it only waits on another suggestion of the same file (a new scene's frames). */
const waits = (flag: SuggestionFlag): boolean => flag.kind === 'waiting' || flag.kind === 'waiting_after';

/** A stored id in a list as the reserve counts it: letters, digits and dashes, at most a UUID's 36 (one byte each). */
const STORED_ID = new RegExp(`^[0-9A-Za-z-]{0,${String(ID_CHARS)}}$`);

/** A time as a call sheet's `before` holds it (the review's `seen`): none, or "HH:MM". */
const sheetLeaf = (value: unknown): boolean => value === null || (typeof value === 'string' && value.length <= 5);

/**
 * Whether a `before` value is within its field's stored bound (round 5), so the reserve for it is never less than its
 * real size. A value past it is refused in fixed words before the build, whatever was sent.
 */
function withinBound(bound: StoredBound, value: JsonValue): boolean {
  switch (bound.kind) {
    case 'text':
      return value === null || (typeof value === 'string' && value.length <= bound.max);
    case 'short':
      return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= SHORT_VALUE);
    case 'ids':
      return value === null || (Array.isArray(value) && value.length <= bound.most && value.every((id) => typeof id === 'string' && STORED_ID.test(id)));
    case 'by_key':
      // Made by beforeOf from the keys sent: a department's time, or a person's times by key.
      return isObject(value) && Object.values(value).every((inner) => sheetLeaf(inner) || (isObject(inner) && Object.values(inner).every(sheetLeaf)));
  }
}

/** What reads worst as UTF-8 JSON: a control character, written `\u0001`, 6 bytes for one character. */
const WORST = '\u0001';

/**
 * The value a `before` is counted at (round 5): the largest its bound lets it be, as UTF-8 JSON at its worst, so the
 * stand-in is never smaller than any value within the bound, in compact or indented JSON. A call sheet's map keeps the
 * keys sent and counts each time at its worst.
 */
function reserveFor(bound: StoredBound, value: JsonValue): JsonValue {
  switch (bound.kind) {
    case 'text':
      return WORST.repeat(bound.max);
    case 'short':
      return WORST.repeat(SHORT_VALUE);
    case 'ids':
      return Array.from({ length: bound.most }, () => 'x'.repeat(ID_CHARS));
    case 'by_key': {
      const leaf = WORST.repeat(5);
      const out: Obj = {};
      for (const [key, inner] of Object.entries(isObject(value) ? value : {})) {
        const times: Obj = {};
        if (isObject(inner)) for (const k of Object.keys(inner)) Object.defineProperty(times, k, { value: leaf, enumerable: true, writable: true, configurable: true });
        Object.defineProperty(out, key, { value: isObject(inner) ? times : leaf, enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
  }
}

/** A suggestion's `before`, as named values. */
const beforeIn = (s: FileSuggestion): [string, JsonValue][] => {
  const before = s.data.before;
  return before !== undefined && before !== null && typeof before === 'object' && !Array.isArray(before) ? Object.entries(before) : [];
};

/** A `before` field's stored bound, by the scope row; null for one outside it (never written: beforeOf leaves it out). */
const boundOf = (s: FileSuggestion, field: string): StoredBound | null => {
  const entry = scopeType(scopeRowFor(), s.target.type);
  return (entry ? scopeField(entry, field) : null)?.stored ?? null;
};

/**
 * The row's checks that read no records (round 5: lengths, choices, ranges, shapes), on every field sent, before
 * anything is built or read: a function of what was sent alone, in 7.0's own words.
 */
function shapeProblems(suggestions: readonly FileSuggestion[]): string[] {
  const problems: string[] = [];
  for (const s of suggestions) {
    const entry = scopeType(scopeRowFor(), s.target.type);
    if (!entry || (s.kind !== 'update' && s.kind !== 'create')) continue;
    const flags: SuggestionFlag[] = [];
    for (const [field, value] of fieldsIn(s)) {
      const problem = scopeField(entry, field)?.shape(value) ?? null;
      if (problem) flags.push({ kind: 'invalid', field, problem });
    }
    if (flags.length > 0) problems.push(`${s.target.label}: ${[...new Set(flags.map((flag) => reviewFlagWords(flag, s.target.type)))].join(' ')}`);
  }
  return problems;
}

/**
 * A stored value past its own bound (round 5): a `before` past its field's, or a target's time past the format's. In
 * fixed words naming the suggestion and the field, whatever was sent.
 */
function storedProblems(suggestions: readonly FileSuggestion[]): string[] {
  const problems: string[] = [];
  for (const s of suggestions) {
    const fields = beforeIn(s).flatMap(([field, value]) => {
      const bound = boundOf(s, field);
      return bound && withinBound(bound, value) ? [] : [field];
    });
    const time = s.target.updated_at;
    if (time !== undefined && time.length > SUGGESTION_BOUNDS.time) fields.push('its last change');
    if (fields.length > 0) problems.push(`${s.target.label}: what the project holds in ${fields.join(', ')} is more than a suggestion can carry. Change it in Storiiboard.`);
  }
  return problems;
}

/** The suggestions with every `before` value and target time at its reserve: what the size checks read (round 5). */
function atReserve(suggestions: readonly FileSuggestion[]): FileSuggestion[] {
  return suggestions.map((s) => {
    const target = s.target.updated_at === undefined ? s.target : { ...s.target, updated_at: WORST.repeat(SUGGESTION_BOUNDS.time) };
    if (s.data.before === undefined) return { ...s, target };
    const before: Obj = {};
    for (const [field, value] of beforeIn(s)) {
      const bound = boundOf(s, field);
      // Checked by storedProblems first: every field has a bound.
      if (bound) Object.defineProperty(before, field, { value: reserveFor(bound, value), enumerable: true, writable: true, configurable: true });
    }
    return { ...s, target, data: { ...s.data, before } };
  });
}

/** A checked change file, and the size it was counted at: the room check counts the new file at this (round 5). */
export interface CheckedChangeFile extends BuiltChangeFile {
  reserveBytes: number;
}

/**
 * The suggestions built as the file and read as the app will read them (round 5): first as they would be with every
 * `before` at its reserve, through 7.1's reader within its bounds (5 MB, 256 KB a suggestion, 10,000 characters a
 * string), a function of what was sent alone; then the real file, which can only be smaller, asserted to pass the same
 * reader; then each suggestion by 7.0's reader against the project, beside the others of the file, under the
 * assistant's scope row, for its flags alone. The problems in words, none when it can be written.
 */
function reviewed(context: ToolContext, suggestions: readonly FileSuggestion[], at: Date): { built: CheckedChangeFile; problems: string[] } {
  const { data } = context;
  const id = crypto.randomUUID();
  const input = { projectId: data.projectId, projectName: data.name, client: context.client ?? 'MCP client', at, id };
  const reserve = buildChangeFile({ ...input, suggestions: atReserve(suggestions) });
  const counted = { ...reserve, reserveBytes: reserve.bytes.byteLength };
  if (reserve.bytes.byteLength > MAX_CHANGE_FILE_BYTES) return { built: counted, problems: ['The change file would be larger than 5 MB. Suggest fewer at a time.'] };
  const atMost = readChangeFile(reserve.bytes, data.projectId);
  if (!atMost.ok) return { built: counted, problems: [refusalWords(atMost.refusal)] };

  const real = buildChangeFile({ ...input, suggestions });
  const built = { ...real, reserveBytes: reserve.bytes.byteLength };
  const file = readChangeFile(real.bytes, data.projectId);
  // Every bound was decided at the reserve, which no value within its bound can pass: a refusal here is a fault in this
  // code, never an answer.
  if (!file.ok || real.bytes.byteLength > reserve.bytes.byteLength) throw new Error('The change file was larger than its reserve.');
  const records: Record<string, SbdRecord> = { ...data.records };
  const stamp = at.toISOString();
  for (const s of file.file.suggestions) {
    if (Object.hasOwn(records, s.id)) return { built, problems: ['Try again.'] };
    Object.defineProperty(records, s.id, {
      value: { id: s.id, type: 'suggestion', parentId: data.projectId, sortKey: '~', props: s.props, trashedAt: null, trashedBy: null, createdAt: stamp, updatedAt: stamp },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const problems: string[] = [];
  file.file.suggestions.forEach((s, i) => {
    const label = suggestions[i]?.target.label ?? `Suggestion ${String(i + 1)}`;
    // Flags alone (round 5): no edit is worked out, so `no_change` is never made and the work never depends on whether
    // a value sent equals the stored one.
    const review = reviewSuggestion(records, data.projectId, s.id, data.slate, 'flags');
    if (!review) {
      problems.push(`${label}: it can't be read.`);
      return;
    }
    // Round 4: "nothing to change" is no refusal. Whether a value is what the project holds would say what a hidden one
    // is; the suggestion is written like any other, and the review screen says so (Apply only marks it applied).
    const refusing = review.flags.filter((flag) => !waits(flag) && flag.kind !== 'no_change');
    if (refusing.length > 0) problems.push(`${label}: ${[...new Set(refusing.map((flag) => reviewFlagWords(flag, review.suggestion.targetType)))].join(' ')}`);
    else if (!review.canApply && !review.flags.some(waits)) problems.push(`${label}: it can't be applied.`);
  });
  return { built, problems };
}

/** Longest field, type or kind name a refusal says back, as 7.0's reader cuts it. */
const MAX_NAME_WORD = 40;

/**
 * Each suggestion's kind, type and fields against the assistant's scope row, before anything is built (round 4): a
 * function of what was sent alone, so no stored value, nor its length, decides it. The words are 7.0's own flags'.
 */
function scopeProblems(suggestions: readonly FileSuggestion[]): string[] {
  const row = scopeRowFor();
  const problems: string[] = [];
  for (const s of suggestions) {
    const type = s.target.type;
    const entry = scopeType(row, type);
    const flags: SuggestionFlag[] = [];
    if (!entry) flags.push({ kind: 'outside_scope', what: 'type', name: cleanText(type, MAX_NAME_WORD) || '?' });
    else if (!entry.kinds.includes(s.kind)) flags.push({ kind: 'outside_scope', what: 'kind', name: s.kind });
    else if (s.kind === 'update' || s.kind === 'create') {
      for (const [field] of fieldsIn(s)) if (!scopeField(entry, field)) flags.push({ kind: 'outside_scope', what: 'field', name: cleanText(field, MAX_NAME_WORD) || '?' });
    }
    if (flags.length > 0) problems.push(`${s.target.label}: ${[...new Set(flags.map((flag) => reviewFlagWords(flag, type)))].join(' ')}`);
  }
  return problems;
}

/**
 * The proposal checked and built as the file it will be, in this order (round 4): its bounds; the scope row (kinds,
 * types and fields); the free-text rule on every value and note; and only then every suggestion as the app will read it
 * (7.1's reader on the bytes, 7.0's under the assistant's scope row, no flag but waiting on another of the file, and
 * "nothing to change" let through). Everything before the build is a function of what was sent alone, so a refusal for a
 * contact or a field never depends on anything stored. Throws a ToolError with every problem in words. Round 3: the
 * file built once is the file written, exactly as the assistant sent it; nothing in it is matched against what the
 * project stores. Round 5: then the row's checks that read no records, then a stored value past its bound (fixed words),
 * and every size from the reserves (reviewed).
 */
export function checkedChangeFile(context: ToolContext, proposal: Proposal, at: Date = new Date()): CheckedChangeFile {
  if (proposal.suggestions.length === 0) throw new ToolError('Nothing to suggest.');
  if (proposal.suggestions.length > MAX_PER_CALL) throw new ToolError(`One call makes at most ${String(MAX_PER_CALL)} suggestions: suggest fewer at a time.`);
  if (proposal.suggestions.some((s) => s.note.length > SUGGESTION_BOUNDS.note)) throw new ToolError(`Nothing was written. The note is longer than ${String(SUGGESTION_BOUNDS.note)} characters.`);

  const outside = scopeProblems(proposal.suggestions);
  if (outside.length > 0) throw new ToolError(`Nothing was written. ${outside.join(' ')}`);

  const problems: string[] = [];
  for (const s of proposal.suggestions) {
    for (const [field, value] of fieldsIn(s)) {
      if (strings(value).some(showsContact)) problems.push(`${s.target.label}: ${field} holds ${CONTACT_WORDS}. Contact details are never suggested: leave them out.`);
    }
    if (showsContact(s.note)) problems.push(`${s.target.label}: the note holds ${CONTACT_WORDS}. Leave contact details out.`);
  }
  if (problems.length > 0) throw new ToolError(`Nothing was written. ${[...new Set(problems)].join(' ')}`);

  const shapes = shapeProblems(proposal.suggestions);
  if (shapes.length > 0) throw new ToolError(`Nothing was written. ${shapes.join(' ')}`);
  const stored = storedProblems(proposal.suggestions);
  if (stored.length > 0) throw new ToolError(`Nothing was written. ${stored.join(' ')}`);

  const first = reviewed(context, proposal.suggestions, at);
  if (first.problems.length > 0) throw new ToolError(`Nothing was written. ${first.problems.join(' ')}`);
  return first.built;
}
