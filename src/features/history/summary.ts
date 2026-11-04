import { mediaFields } from '../../core/media/store';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import type { JsonValue, Props, SbdRecord } from '../../core/model/record';
import { SHOT_STATUS_LABELS } from '../../core/model/shotStatus';
import { pageLabel, sceneFields, sceneLabel, SHOT_SIZE_LABEL, shotFields } from '../../core/model/storyboard';
import type { GroupKind, LoggedOp, OpGroup } from '../../core/ops/ops';

// What each step in History says (1.22): one line for an op group, in the board's words ("Added frame 4C", "4A: lens
// 35 → 50"), worked out from its ops' before and after. A drag that renumbers a scene is one step, "Moved 4B"; the
// renumbering it carried isn't listed apart. Undo, redo and restore name the step they went back to.

/**
 * A piece of a line: words, or a technical value (a shot or scene number, a lens, a T-stop) that the tile sets in
 * JetBrains Mono, as every technical value is (CLAUDE.md, Design). Kept apart in the line rather than found again
 * in its text, so a count ("3 frames") or a typed value never turns mono by looking like a number.
 */
export type Part = string | { mono: string };
export type Line = readonly Part[];

/** A line as plain text: for labels, notices and tests. */
export const lineText = (line: Line): string => line.map((part) => (typeof part === 'string' ? part : part.mono)).join('');

/** Props by the names the inspector and the board give them. */
const FIELD: Readonly<Record<string, string>> = {
  number: 'number',
  size: 'size',
  lens_mm: 'lens',
  t_stop: 'T-stop',
  support: 'support',
  height: 'height',
  move: 'move',
  status: 'status',
  action: 'action',
  dialogue: 'dialogue',
  departments: 'departments',
  media_id: 'picture',
  crop: 'framing',
  custom: 'custom fields',
  name: 'name',
  int_ext: 'INT/EXT',
  day_night: 'time of day',
  location_id: 'location',
  page_eighths: 'length',
  numbers_locked: 'number lock',
  characters: 'characters',
  text: 'text',
  theme: 'theme',
  title: 'title',
  notes: 'notes',
  aspect_ratio: 'aspect ratio',
  state: 'state',
};

/** Values that are slate and camera data, set in mono wherever a line shows them. */
const MONO = new Set(['number', 'lens_mm', 't_stop']);

export const fieldLabel = (prop: string): string => FIELD[prop] ?? prop.replace(/_/g, ' ');

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The parts of a watermark (Watermark Settings, 1.24), by the names the dialog gives them. */
const WATERMARK_PART: Readonly<Record<string, string>> = { text: 'text', position: 'position', opacity: 'strength', applies_to: 'on' };

function watermarkPart(part: string, value: JsonValue | undefined): string {
  if (part === 'text') return typeof value === 'string' ? `“${value.length > 30 ? `${value.slice(0, 29)}…` : value}”` : '—';
  if (part === 'opacity') return typeof value === 'number' ? `${String(Math.round(value * 100))}%` : '—';
  if (part === 'position') return typeof value === 'string' ? value.replace(/-/g, ' ').replace('center', 'centre') : '—';
  return Array.isArray(value) && value.length > 0 ? value.map((v) => (typeof v === 'string' ? v.toUpperCase() : JSON.stringify(v))).join(', ') : '—';
}

/**
 * A watermark step in words. The prop is one object, so the plain line read "watermark changed → changed" and
 * someone looking for the strength they had before couldn't tell one step from the next.
 */
function describeWatermark(before: JsonValue | undefined, after: JsonValue | undefined): string {
  const text = (value: JsonObject) => watermarkPart('text', value.text);
  if (!isObject(after)) return isObject(before) ? `Removed the watermark ${text(before)}` : 'Removed the watermark';
  if (!isObject(before)) return `Set the watermark ${text(after)}`;
  const parts = Object.keys(WATERMARK_PART).filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
  const [only] = parts;
  if (parts.length === 1 && only) {
    return `Watermark ${only === 'text' ? '' : `${text(after)} `}${WATERMARK_PART[only] ?? only}: ${watermarkPart(only, before[only])} → ${watermarkPart(only, after[only])}`;
  }
  return `Changed the watermark ${text(after)}: ${parts.map((part) => WATERMARK_PART[part] ?? part).join(', ')}`;
}

/** Whether a field's values are technical ones, shown in mono. */
export const isMono = (prop: string): boolean => MONO.has(prop);

/** A stored code by the word the board and the inspector show for it ("hmu" → "HMU", "need" → "Need to shoot"). */
const CHOICE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  departments: DEPARTMENT_LABELS,
  status: SHOT_STATUS_LABELS,
  size: SHOT_SIZE_LABEL,
};
/** Support, height and move are words already; the inspector's menus start them with a capital. */
const CAPITALISED = new Set(['support', 'height', 'move']);
const choiceLabel = (prop: string, value: string): string => {
  const table = CHOICE[prop];
  if (table && Object.hasOwn(table, value)) return table[value] ?? value;
  return CAPITALISED.has(prop) ? value.charAt(0).toUpperCase() + value.slice(1) : value;
};

/** A value as a step's line shows it: in the board's words, `—` for nothing, and a long text cut to one short line. */
export function valueLabel(prop: string, value: JsonValue | undefined): string {
  const text = valueText(prop, value);
  if (typeof value !== 'string' && typeof value !== 'number') return text;
  const line = text.replace(/\s+/g, ' ');
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

/**
 * A value in full, line breaks and all: what an item's own history shows, since that's where a person reads an old
 * action or dialogue before putting it back over the one there now.
 */
export function valueText(prop: string, value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  // Its text, where and how strong, so an old watermark can be told apart before it's put back.
  if (prop === 'watermark' && isObject(value)) {
    return `${watermarkPart('text', value.text)}, ${watermarkPart('position', value.position)}, ${watermarkPart('opacity', value.opacity)}`;
  }
  // Kept by id, which means nothing to a person: a step names the location as it was then (describeEdit), and a
  // picture change reads as set, removed or replaced (pictureChange).
  if (prop === 'location_id') return 'a location';
  if (prop === 'media_id') return 'a picture';
  if (prop === 'lens_mm' && typeof value === 'number') return `${String(value)}mm`;
  if (prop === 't_stop' && typeof value === 'number') return `T${String(value)}`;
  // A scene's length, as a breakdown sheet reads it ("1 3/8 pg"), never its stored count of eighths.
  if (prop === 'page_eighths' && typeof value === 'number') return pageLabel(value);
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => (typeof v === 'string' ? choiceLabel(prop, v) : JSON.stringify(v))).join(', ');
  if (typeof value === 'object') return prop === 'custom' ? Object.keys(value).join(', ') || '—' : 'changed';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return typeof value === 'string' ? choiceLabel(prop, value) : String(value);
}

const valuePart = (prop: string, value: JsonValue | undefined): Part => {
  const label = valueLabel(prop, value);
  return isMono(prop) && label !== '—' ? { mono: label } : label;
};

const isBlank = (value: JsonValue | undefined) => value === undefined || value === null || value === '';

/** What a change of a frame's picture did, since its value is only an id. */
export const pictureChange = (change: FieldChange): string =>
  isBlank(change.before) ? 'picture set' : isBlank(change.after) ? 'picture removed' : 'picture replaced';

/** The props an update changed, by name. */
export function changedProps(before: SbdRecord, after: SbdRecord): string[] {
  const keys = new Set([...Object.keys(before.props), ...Object.keys(after.props)]);
  return [...keys].filter((key) => JSON.stringify(before.props[key]) !== JSON.stringify(after.props[key]));
}

/**
 * One field's change. A custom field is one entry of the frame's `custom` prop (1.19), so it's a change of its own,
 * named by the field's name: putting back "Drone" must leave "VFX" as it is now.
 */
export interface FieldChange {
  prop: string;
  /** For a custom field: its name in `custom`. */
  key?: string;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

const customOf = (props: Props): Readonly<Record<string, JsonValue>> => {
  const custom = props.custom;
  return typeof custom === 'object' && custom !== null && !Array.isArray(custom) ? custom : {};
};

/** Every field an op changed, each custom field on its own. */
export function fieldChanges(before: SbdRecord, after: SbdRecord): FieldChange[] {
  return changedProps(before, after).flatMap((prop): FieldChange[] => {
    if (prop !== 'custom') return [{ prop, before: before.props[prop], after: after.props[prop] }];
    const was = customOf(before.props);
    const now = customOf(after.props);
    return [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]))
      .map((key) => ({ prop, key, before: was[key], after: now[key] }));
  });
}

/** A field's name in a line: a custom field by its own name. */
export const changeLabel = (change: FieldChange): string => change.key ?? fieldLabel(change.prop);
/**
 * A change's value. A custom field that isn't on the frame at all reads "no field", apart from an empty one (`—`):
 * putting back one takes the field off, the other keeps it.
 */
export const changeValue = (change: FieldChange, value: JsonValue | undefined): string =>
  change.key === undefined ? valueLabel(change.prop, value) : value === undefined ? 'no field' : valueLabel('', value);
/** A change's value in full, for an item's own history and its Put back: never cut short. */
export const changeText = (change: FieldChange, value: JsonValue | undefined): string =>
  change.key === undefined ? valueText(change.prop, value) : value === undefined ? 'no field' : valueText('', value);
const changeValuePart = (change: FieldChange, value: JsonValue | undefined): Part =>
  change.key === undefined ? valuePart(change.prop, value) : changeValue(change, value);

/** How a record is named in a step: a frame by its number, a scene by its slate label. */
function nameOf(record: SbdRecord | null): Part {
  if (!record) return 'an item';
  switch (record.type) {
    case 'shot': {
      const number = shotFields(record.props).number;
      return number ? { mono: number } : 'a frame';
    }
    case 'scene':
      return { mono: sceneLabel(sceneFields(record.props).number) };
    case 'note':
      return 'a note';
    case 'location':
      return typeof record.props.name === 'string' ? record.props.name : 'a location';
    case 'character':
      return typeof record.props.name === 'string' ? record.props.name : 'a character';
    case 'project':
      return 'the project';
    default:
      return `a ${record.type}`;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
const capitalise = (part: Part): Part => (typeof part === 'string' ? part.charAt(0).toUpperCase() + part.slice(1) : part);

/** The word for a kind of record in a count: "3 frames", "a note". */
const NOUN: Readonly<Partial<Record<SbdRecord['type'], string>>> = {
  shot: 'frame',
  scene: 'scene',
  note: 'note',
  location: 'location',
  character: 'character',
  stroke: 'stroke',
  media: 'picture',
};

/**
 * An op whose record Empty Trash deleted for good: it keeps its kind, but not the record before and after (1.21), so
 * neither its type nor its name is known any more.
 */
const purged = (op: LoggedOp) => op.kind !== 'purge' && op.before === null && op.after === null;

/**
 * One line for an edit group, from its ops. `stored` holds the pictures still in the file; `around`, records the step
 * names without writing them (a sketch's frame, a scene's location), as they were then.
 */
export function describeEdit(ops: readonly LoggedOp[], stored: ReadonlySet<string>, around: ReadonlyMap<string, SbdRecord> = new Map()): Line {
  if (ops.length === 0) return ['No change'];
  const record = (op: LoggedOp) => op.after ?? op.before;
  const of = (kind: LoggedOp['kind'], type?: SbdRecord['type']) => ops.filter((op) => op.kind === kind && (!type || record(op)?.type === type));
  const since = ', since deleted for good';
  const items = (n: number) => (n === 1 ? 'an item' : plural(n, 'item'));
  const removed = ops.some((op) => {
    const media = record(op);
    const sha = media?.type === 'media' ? mediaFields(media.props)?.sha256 : undefined;
    return sha !== undefined && !stored.has(sha);
  });
  const tag = removed ? ' (picture removed)' : '';
  // A change of look: the theme, with or without a new logo.
  if (ops.some((op) => op.after?.type === 'project' && op.before && JSON.stringify(op.before.props.theme) !== JSON.stringify(op.after.props.theme))) {
    return [`Changed the theme${tag}`];
  }
  const watermark = ops.find((op) => record(op)?.type === 'project' && op.before && op.after && JSON.stringify(op.before.props.watermark) !== JSON.stringify(op.after.props.watermark));
  if (watermark) return [`${describeWatermark(watermark.before?.props.watermark, watermark.after?.props.watermark)}${tag}`];

  // Most telling first: what was made, deleted, brought back or moved; then what changed.
  for (const [kind, verb] of [
    ['create', 'Added'],
    ['trash', 'Deleted'],
    ['restore', 'Restored'],
  ] as const) {
    for (const type of ['scene', 'shot', 'note', 'media', 'stroke', 'location', 'character'] as const) {
      const found = of(kind, type);
      if (found.length === 0) continue;
      const noun = NOUN[type] ?? type;
      if (type === 'media') {
        const shot = ops.find((op) => op.kind === 'update' && record(op)?.type === 'shot');
        const what = kind === 'create' ? 'Set the picture of' : verb === 'Deleted' ? 'Removed the picture of' : 'Restored the picture of';
        return [`${what} `, nameOf(shot ? record(shot) : null), tag];
      }
      if (type === 'stroke') {
        // A stroke is all a sketch writes, so its frame is named from the frame as it was then (`around`).
        const shotId = found[0]?.after?.parentId ?? found[0]?.before?.parentId ?? null;
        const written = ops.find((op) => op.recordId === shotId);
        const shot = written ? record(written) : shotId === null ? null : (around.get(shotId) ?? null);
        const frame = shot ? nameOf(shot) : 'a frame';
        return kind === 'create' ? ['Sketched on ', frame] : [`${kind === 'trash' ? 'Erased' : 'Restored'} ${plural(found.length, 'stroke')} on `, frame];
      }
      const first = found[0];
      if (found.length > 1 || !first) return [`${verb} ${plural(found.length, noun)}`];
      return type === 'note' ? [`${verb} a note`] : [`${verb} ${noun} `, nameOf(record(first))];
    }
    // Checked before the moves and updates below: a delete renumbers the frames after it in the same step, and once
    // the deleted frame is gone for good those renumbers are all that's left to read, so it would pass for an edit.
    const lost = ops.filter((op) => op.kind === kind && purged(op));
    if (lost.length > 0) return [`${verb} ${items(lost.length)}${since}${tag}`];
  }
  const moves = of('move');
  const moved = moves[0];
  if (moved) {
    if (moves.length > 1) return [`Moved ${plural(moves.length, 'item')}`];
    return purged(moved) ? [`Moved an item${since}`] : ['Moved ', nameOf(record(moved))];
  }
  const updates = ops.filter((op) => op.kind === 'update' && op.before && op.after);
  const lostUpdates = ops.filter((op) => op.kind === 'update' && purged(op));
  if (updates.length === 0 && lostUpdates.length > 0) return [`Changed ${items(new Set(lostUpdates.map((op) => op.recordId)).size)}${since}${tag}`];
  if (updates.length === 1 || new Set(updates.map((op) => op.recordId)).size === 1) {
    const op = updates[0];
    if (op?.before && op.after) {
      const changes = fieldChanges(op.before, op.after);
      const who = capitalise(nameOf(op.after));
      const [only] = changes;
      if (changes.length === 1 && only?.key !== undefined && (only.before === undefined || only.after === undefined)) {
        return [who, `: ${only.before === undefined ? 'added' : 'removed'} the field ${only.key}${tag}`];
      }
      if (changes.length === 1 && only?.prop === 'media_id') return [who, `: ${pictureChange(only)}${tag}`];
      if (changes.length === 1 && only) {
        const value = (v: JsonValue | undefined): Part => {
          if (only.prop !== 'location_id' || typeof v !== 'string' || v === '') return changeValuePart(only, v);
          const place = around.get(v);
          return place ? nameOf(place) : 'a location';
        };
        return [who, `: ${changeLabel(only)} `, value(only.before), ' → ', value(only.after), tag];
      }
      return [who, `: ${[...new Set(changes.map(changeLabel))].join(', ')}${tag}`];
    }
  }
  if (updates.length > 0) {
    // A renumber or a lock touches many frames: named by the scene they share when they share one.
    return [`Changed ${plural(new Set(updates.map((op) => op.recordId)).size, 'item')}${tag}`];
  }
  return [`${plural(ops.length, 'change')}${tag}`];
}

/**
 * A step's line. Undo and redo say what they took back or did again; a restore, the point it went back to; Empty
 * Trash, how many items it deleted for good.
 */
export function describeGroup(
  group: OpGroup,
  ops: readonly LoggedOp[],
  titles: ReadonlyMap<string, Line>,
  stored: ReadonlySet<string>,
  around: ReadonlyMap<string, SbdRecord> = new Map(),
): Line {
  switch (group.kind) {
    case 'edit':
      return describeEdit(ops, stored, around);
    case 'undo':
      return ['Undid: ', ...(titles.get(group.targetGroupId ?? '') ?? ['a step'])];
    case 'redo':
      return ['Redid: ', ...(titles.get(group.targetGroupId ?? '') ?? ['a step'])];
    case 'restore':
      return group.restoreTo === null
        ? ['Restored the project to how it was created']
        : ['Restored the project to: ', ...(titles.get(group.restoreTo) ?? ['an earlier step'])];
    case 'empty_trash':
      return [`Emptied the Trash: ${plural(ops.length, 'item')} deleted for good`];
  }
}

/** Who made a step: "You" until people have names (Phase 9). */
export const who = (author: string): string => (author === 'local' ? 'You' : author);

/** One line of an item's own history: a field's change, or a whole step (added, moved, deleted). */
export interface FrameRow {
  key: string;
  op: LoggedOp;
  /** What happened, as the Change column says it. */
  change: string;
  /** The field it changed; null for a whole step. */
  field: FieldChange | null;
}

/** What a write did to a record as a whole, by the kind of edit it reversed or repeated. */
const KIND_LINE: Readonly<Record<LoggedOp['kind'], string>> = {
  create: 'Added',
  update: 'Changed',
  move: 'Moved',
  retype: 'Changed type',
  trash: 'Deleted',
  restore: 'Restored from the Trash',
  revert: 'Restore to here',
  purge: 'Deleted for good',
};

/** A field changed by going back and forth through History says so beside its name. */
const FIELD_HOW: Readonly<Record<GroupKind, string>> = { edit: '', undo: ', undone', redo: ', redone', restore: ', restored', empty_trash: '' };

/** What Restore to here did to a record as a whole: its op is a `revert` whatever it changed. */
function revertLine(before: SbdRecord | null, after: SbdRecord | null): string | null {
  if (!before) return 'Restore to here: added back';
  if (!after) return 'Restore to here: taken away';
  if (before.trashedAt === null && after.trashedAt !== null) return 'Restore to here: back in the Trash';
  if (before.trashedAt !== null && after.trashedAt === null) return 'Restore to here: out of the Trash';
  if (before.parentId !== after.parentId || before.sortKey !== after.sortKey) return 'Restore to here: moved';
  return null;
}

/** The whole-step line for an op, or null when its field rows say it all. */
function stepLine(op: LoggedOp): string | null {
  if (op.kind === 'revert') {
    const line = revertLine(op.before, op.after);
    // An undone restore's ops are reverts too: worded as the restore they take back, not what it did.
    if (op.groupKind === 'restore' || line === null) return line;
    return op.groupKind === 'undo' ? 'Undid: Restore to here' : 'Redid: Restore to here';
  }
  if (op.kind === 'update') return null;
  // Undo and redo ops keep the kind they reverse (src/core/ops/ops.ts), so the group says which way it went.
  const base = KIND_LINE[op.kind];
  return op.groupKind === 'undo' ? `Undid: ${base}` : op.groupKind === 'redo' ? `Redid: ${base}` : base;
}

/** What a step did to a frame's sketch or picture, which are records of their own under it. */
function childLine(type: SbdRecord['type'] | undefined, kind: LoggedOp['kind'], n: number): string {
  if (type === 'media') {
    const what: Partial<Record<LoggedOp['kind'], string>> = { create: 'Set the picture', trash: 'Removed the picture', restore: 'Restored the picture' };
    return what[kind] ?? (kind === 'revert' ? 'Restore to here: the picture' : 'Changed the picture');
  }
  switch (kind) {
    case 'create':
      return n === 1 ? 'Sketched' : `Sketched ${plural(n, 'stroke')}`;
    case 'trash':
      return `Erased ${plural(n, 'stroke')}`;
    case 'restore':
      return `Restored ${plural(n, 'stroke')}`;
    case 'revert':
      return 'Restore to here: the sketch';
    default:
      return 'Changed the sketch';
  }
}

/**
 * Ops by the step they're in, each step's in the order given. Pushed onto, never copied: one step can be tens of
 * thousands of ops (a Restore to here, an Empty Trash, a big erase), and copying a step's list for every op in it takes
 * seconds there, on the UI thread, every time History is read again.
 */
export function byStep(ops: readonly LoggedOp[]): Map<string, LoggedOp[]> {
  const steps = new Map<string, LoggedOp[]>();
  for (const op of ops) {
    const list = steps.get(op.groupId);
    if (list) list.push(op);
    else steps.set(op.groupId, [op]);
  }
  return steps;
}

/**
 * Every change to one item, newest first, field by field. Its number is listed too, though the board keeps it in
 * step and it isn't put back on its own, so an editor matching a slate can see when a frame was renumbered.
 *
 * `ops` may hold its children's ops too (a frame's strokes and picture): each step's are one whole-step row,
 * "Sketched" or "Erased 2 strokes", since sketching writes only the stroke and would otherwise never show here. A
 * picture's own ops are left out where the frame's `picture` row already says it. Rows are keyed by op, so a new
 * step above them never makes them other rows.
 */
export function frameRows(ops: readonly LoggedOp[], itemId: string): FrameRow[] {
  const ownGroups = new Set(ops.filter((op) => op.recordId === itemId).map((op) => op.groupId));
  const children = byStep(
    ops.filter((op) => op.recordId !== itemId && !((op.after ?? op.before)?.type === 'media' && ownGroups.has(op.groupId))),
  );
  const listed = new Set<string>();
  return [...ops].reverse().flatMap((op): FrameRow[] => {
    if (op.recordId !== itemId) {
      const group = children.get(op.groupId);
      if (!group || listed.has(op.groupId)) return [];
      listed.add(op.groupId);
      const first = group[0] ?? op;
      const type = (first.after ?? first.before)?.type;
      const same = group.filter((o) => o.kind === first.kind && (o.after ?? o.before)?.type === type).length;
      const base = childLine(type, first.kind, same);
      const how = op.groupKind === 'undo' ? 'Undid: ' : op.groupKind === 'redo' ? 'Redid: ' : '';
      return [{ key: `${op.groupId}:children`, op, change: `${how}${base}`, field: null }];
    }
    const rows: FrameRow[] = [];
    const line = stepLine(op);
    if (line !== null) rows.push({ key: op.id, op, change: line, field: null });
    if (op.before && op.after) {
      for (const field of fieldChanges(op.before, op.after)) {
        const name = field.prop === 'media_id' ? pictureChange(field) : changeLabel(field);
        rows.push({ key: `${op.id}:${field.prop}:${field.key ?? ''}`, op, change: `${name}${FIELD_HOW[op.groupKind]}`, field });
      }
    }
    // An update that changed nothing a person sees still happened: say so rather than drop it.
    if (rows.length === 0) rows.push({ key: op.id, op, change: KIND_LINE[op.kind], field: null });
    return rows;
  });
}
