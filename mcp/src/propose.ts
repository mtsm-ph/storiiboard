import { contactGuard, withoutContacts, withoutStoredContacts, type ContactGuard } from '../../src/core/model/assistantView';
import { dayCallsheet } from '../../src/core/model/callsheet';
import { gearFields, gearIdsOf, projectGear } from '../../src/core/model/gear';
import { locationFields, projectLocations } from '../../src/core/model/location';
import { personFields, projectPeople } from '../../src/core/model/person';
import type { JsonValue, SbdRecord } from '../../src/core/model/record';
import { dayLabel, type ShootDay } from '../../src/core/model/shootDay';
import { sceneFields, sceneLabel, shotFields } from '../../src/core/model/storyboard';
import { reviewFlagWords, reviewSuggestion, SUGGESTION_BOUNDS, type SuggestionFlag } from '../../src/core/model/suggestion';
import { boardScene } from '../../src/core/ops/storyboardEdits';
import { MAX_CHANGE_FILE_BYTES, MAX_SUGGESTIONS, readChangeFile, refusalWords } from '../../src/core/storage/changeFile';
import { buildChangeFile, type BuiltChangeFile, type FileSuggestion } from './changeFile';
import { boardScenes, dayOf, read, sceneByNumber, ToolError, type Read, type ToolContext } from './tools';

// The propose tools (7.6, Phase 7 decisions 3, 4 and 16): each turns plain arguments (a scene number, a frame number, a
// day by date or number, field values as the app's own) into 7.0's suggestions, their `before` values from the project
// as read, and checks them before anything is written: every suggestion through 7.0's reader under the assistant's
// scope row (reviewSuggestion, as the review screen will read it), and the whole file through 7.1's reader, the very
// bytes that will be written. Anything refused is said in words at once and nothing is written, so the assistant
// learns. Pure: the server's write is changeFolder.ts's alone. A contact detail is never suggested: a value that reads as
// a phone number, an email, coordinates or a map link, or holds one the project stores, is refused.

type Obj = { [key: string]: JsonValue };
type Records = Readonly<Record<string, SbdRecord>>;

/** What one call proposes: the file's suggestions, each said in a line for the answer. */
export interface Proposal {
  suggestions: FileSuggestion[];
  lines: string[];
}

/** Most frames one call adds, frames one call changes, moves and items one call trashes. */
export const MAX_PER_CALL = 200;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value from the call as JSON: it came as JSON, but a value is never trusted to be one. */
function jsonOf(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ToolError(`${field} isn't a number it takes.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((inner) => jsonOf(inner, field));
  if (isObject(value)) {
    const out: Obj = {};
    for (const [key, inner] of Object.entries(value)) Object.defineProperty(out, key, { value: jsonOf(inner, field), enumerable: true, writable: true, configurable: true });
    return out;
  }
  throw new ToolError(`${field} isn't a value it takes.`);
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

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
  const live = projectLocations(r.scoped, r.projectId);
  const found = live.find((l) => l.record.id === value) ?? live.find((l) => sameText(locationFields(l.record.props).name, value));
  if (!found) throw new ToolError(`There's no location "${value}". list_locations lists them.`);
  return found.record.id;
}

/** A live gear item of the catalogue by its id or its name. */
function gearOf(r: Read, value: string): string {
  const live = projectGear(r.scoped, r.projectId);
  const found = live.find((g) => g.record.id === value) ?? live.find((g) => sameText(gearFields(g.record.props).name, value));
  if (!found) throw new ToolError(`There's no gear item "${value}" in the catalogue. list_gear lists it.`);
  return found.record.id;
}

/** A live person by id or name. */
function personOf(r: Read, value: string): string {
  const live = projectPeople(r.scoped, r.projectId);
  const found = live.find((p) => p.record.id === value) ?? live.find((p) => sameText(personFields(p.record.props).name, value));
  if (!found) throw new ToolError(`There's no one named "${value}" in Cast and crew. list_people lists them.`);
  return found.record.id;
}

/** The names the tools take for a field, besides its own: a location, a day and gear by what a person calls them. */
const ALIASES: Readonly<Record<string, string>> = { location: 'location_id', shoot_day: 'shoot_day_id', gear: 'gear_ids' };

/**
 * A frame's or a scene's fields as the call gave them, its plain values made the app's own: a location by name, a shoot
 * day by its date or number, gear by name. A field the scope row doesn't have stays as named, so 7.0's reader refuses it.
 */
function fieldsOf(r: Read, given: unknown, what: string): Obj {
  if (!isObject(given)) throw new ToolError(`${what}: fields are named values ({ "size": "CU", "lens_mm": 85 }).`);
  const out: Obj = {};
  for (const [name, raw] of Object.entries(given)) {
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

/** What the project holds for each named field, as the suggester saw it: its `before`. */
function beforeOf(record: SbdRecord | null, fields: Obj): Obj {
  const out: Obj = {};
  for (const field of Object.keys(fields)) Object.defineProperty(out, field, { value: record?.props[field] ?? null, enumerable: true, writable: true, configurable: true });
  return out;
}

/** When a target was last written, as 7.0's trash and reorder compare it: a scene's, the newest of it and what goes with it. */
function lastWritten(records: Records, target: SbdRecord): string {
  if (target.type !== 'scene') return target.updatedAt;
  let newest = target.updatedAt;
  for (const record of Object.values(records)) {
    if (record.parentId !== target.id || record.trashedAt !== null || (record.type !== 'shot' && record.type !== 'note' && record.type !== 'setup')) continue;
    if (Date.parse(record.updatedAt) > Date.parse(newest)) newest = record.updatedAt;
  }
  return newest;
}

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
    suggestions.push({ id: newId(), kind: 'update', target: { id: shot.id, type: 'shot', label, updated_at: shot.updatedAt }, note: note(args.note), data: { props, before: beforeOf(shot, props) } });
    lines.push(`Change ${label}: ${Object.keys(props).join(', ')}.`);
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
    const { after, ...fields } = args.new_scene;
    // After the scene named, else at the end of the board, as + Add Scene puts one; first on a board with none.
    const live = boardScenes(r, false);
    const afterScene = typeof after === 'string' ? sceneByNumber(r, after) : (live.at(-1) ?? null);
    if (after !== undefined && typeof after !== 'string') throw new ToolError('new_scene.after is a scene number as text ("12").');
    const props = fieldsOf(r, fields, 'new_scene');
    const id = newId();
    const label = afterScene ? `New scene after ${sceneWords(afterScene)}` : 'New scene';
    suggestions.push({ id, kind: 'create', target: { type: 'scene', label }, note: note(args.note), data: { type: 'scene', parent_id: r.projectId, after_id: afterScene?.id ?? null, props } });
    lines.push(`Add a scene${afterScene ? ` after ${sceneWords(afterScene)}` : ''}${typeof props.name === 'string' ? `: ${props.name}` : ''}.`);
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
    lines.push(`Add a frame in ${where}${typeof props.size === 'string' ? ` (${props.size})` : ''}.`);
    // Each after the one before it, so the frames keep the order given (7.0: an after_id may name a create of the file).
    afterId = id;
  });
  return { suggestions, lines };
}

// -- suggest_reorder ---------------------------------------------------------------------------------------------------

export interface ReorderArgs {
  moves: { frame?: string | undefined; scene?: string | undefined; note?: number | undefined; to_scene?: string | undefined; after: string; after_note?: number | undefined }[];
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
    } else if (move.after.trim().toLowerCase() === 'start') {
      afterId = null;
      after = 'to the start';
    } else {
      afterId = frameByNumber(r, move.after, to).shot.id;
      after = `after ${move.after.trim().toUpperCase()}`;
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
  // the end, as the Gear picker puts them. What they can't see stays where it is (7.0's own edit keeps it).
  const live = gearIdsOf(day.record.props).filter((id) => {
    const item = r.scoped[id];
    return item !== undefined && item.trashedAt === null && item.type === 'gear_item';
  });
  const dayName = dayLabel(day);
  for (const id of removes) if (!live.includes(id)) throw new ToolError(`${gearFields(r.scoped[id]?.props ?? {}).name} isn't on ${dayName}’s list.`);
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
  if (args.department_calls !== undefined) set('department_calls', jsonOf(args.department_calls, 'department_calls'));
  if (args.person_times !== undefined) {
    const times: Obj = {};
    for (const [who, value] of Object.entries(args.person_times)) Object.defineProperty(times, personOf(r, who), { value: jsonOf(value, 'person_times'), enumerable: true, writable: true, configurable: true });
    set('person_times', times);
  }
  if (Object.keys(props).length > 0) {
    const label = `Call sheet, ${dayName}`;
    suggestions.push({ id: newId(), kind: 'update', target: { id: day.record.id, type: 'callsheet', label, updated_at: (sheet ?? day.record).updatedAt }, note: note(args.note), data: { props, before: beforeOf(sheet, props) } });
    lines.push(`Change the call sheet for ${dayName}: ${Object.keys(props).join(', ')}.`);
  }
  const dayProps: Obj = {};
  if (args.call_time !== undefined) Object.defineProperty(dayProps, 'call_time', { value: args.call_time, enumerable: true, writable: true, configurable: true });
  if (args.wrap_time !== undefined) Object.defineProperty(dayProps, 'wrap_time', { value: args.wrap_time, enumerable: true, writable: true, configurable: true });
  if (Object.keys(dayProps).length > 0) {
    suggestions.push({ id: newId(), kind: 'update', target: { id: day.record.id, type: 'shoot_day', label: dayName, updated_at: day.record.updatedAt }, note: note(args.note), data: { props: dayProps, before: beforeOf(day.record, dayProps) } });
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

/** Whether a text reads as holding a contact detail: by the free-text rule, or a value the project stores. */
const holdsContact = (guard: ContactGuard, text: string): boolean => withoutContacts(text) !== text || withoutStoredContacts(guard, text) !== text;

/** A flag refuses a suggestion unless it only waits on another suggestion of the same file (a new scene's frames). */
const waits = (flag: SuggestionFlag): boolean => flag.kind === 'waiting' || flag.kind === 'waiting_after';

/**
 * The proposal checked and built as the file it will be: no contact detail in any value or note; every suggestion as
 * 7.0's reader reads it under the assistant's scope row, with no flag but waiting on another of the file; and the
 * file's bytes through 7.1's reader, within its bounds. Throws a ToolError with every problem in words.
 */
export function checkedChangeFile(context: ToolContext, proposal: Proposal, at: Date = new Date()): BuiltChangeFile {
  const { data } = context;
  if (proposal.suggestions.length === 0) throw new ToolError('Nothing to suggest.');
  if (proposal.suggestions.length > MAX_SUGGESTIONS) throw new ToolError(`One change file holds at most ${String(MAX_SUGGESTIONS)} suggestions: suggest fewer at a time.`);
  const guard = contactGuard(data.records);
  const problems: string[] = [];
  for (const s of proposal.suggestions) {
    const props = s.data.props;
    for (const [field, value] of Object.entries(props !== undefined && props !== null && typeof props === 'object' && !Array.isArray(props) ? props : {})) {
      if (strings(value).some((text) => holdsContact(guard, text))) problems.push(`${s.target.label}: ${field} holds what reads as a phone number, an email, coordinates or a map link. Contact details are never suggested: leave them out.`);
    }
    if (holdsContact(guard, s.note)) problems.push(`${s.target.label}: the note holds what reads as a phone number, an email, coordinates or a map link. Leave contact details out.`);
    if (s.note.length > SUGGESTION_BOUNDS.note) problems.push(`The note is longer than ${String(SUGGESTION_BOUNDS.note)} characters.`);
  }
  if (problems.length > 0) throw new ToolError(`Nothing was written. ${[...new Set(problems)].join(' ')}`);

  const built = buildChangeFile({ projectId: data.projectId, projectName: data.name, client: context.client ?? 'MCP client', suggestions: proposal.suggestions, at });
  if (built.bytes.byteLength > MAX_CHANGE_FILE_BYTES) throw new ToolError('Nothing was written: the change file would be larger than 5 MB. Suggest fewer at a time.');
  // 7.1's reader, on the bytes that will be written: what the app will bring in.
  const file = readChangeFile(built.bytes, data.projectId);
  if (!file.ok) throw new ToolError(`Nothing was written: ${refusalWords(file.refusal)}`);
  // Each suggestion as the app will hold it, read by 7.0 against the project as it is, beside the others of the file.
  const records: Record<string, SbdRecord> = { ...data.records };
  const stamp = at.toISOString();
  for (const s of file.file.suggestions) {
    if (Object.hasOwn(records, s.id)) throw new ToolError('Nothing was written: try again.');
    Object.defineProperty(records, s.id, {
      value: { id: s.id, type: 'suggestion', parentId: data.projectId, sortKey: '~', props: s.props, trashedAt: null, trashedBy: null, createdAt: stamp, updatedAt: stamp },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  file.file.suggestions.forEach((s, i) => {
    const asked = proposal.suggestions[i];
    const label = asked?.target.label ?? `Suggestion ${String(i + 1)}`;
    const review = reviewSuggestion(records, data.projectId, s.id, data.slate);
    if (!review) {
      problems.push(`${label}: it can't be read.`);
      return;
    }
    const refusing = review.flags.filter((flag) => !waits(flag));
    if (refusing.length > 0) problems.push(`${label}: ${[...new Set(refusing.map((flag) => reviewFlagWords(flag, review.suggestion.targetType)))].join(' ')}`);
    else if (!review.canApply && !review.flags.some(waits)) problems.push(`${label}: it can't be applied.`);
  });
  if (problems.length > 0) throw new ToolError(`Nothing was written. ${problems.join(' ')}`);
  return built;
}

