import { mediaFields } from '../../core/media/store';
import type { JsonValue, Props, SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
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

/** Whether a field's values are technical ones, shown in mono. */
export const isMono = (prop: string): boolean => MONO.has(prop);

/** A value as a line of History shows it: short, and `—` for nothing. */
export function valueLabel(prop: string, value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  if (prop === 'lens_mm' && typeof value === 'number') return `${String(value)}mm`;
  if (prop === 't_stop' && typeof value === 'number') return `T${String(value)}`;
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  if (typeof value === 'object') return prop === 'custom' ? Object.keys(value).join(', ') || '—' : 'changed';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  const text = String(value).replace(/\s+/g, ' ');
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

const valuePart = (prop: string, value: JsonValue | undefined): Part => {
  const label = valueLabel(prop, value);
  return isMono(prop) && label !== '—' ? { mono: label } : label;
};

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

/** One line for an edit group, from its ops. `stored` holds the pictures still in the file. */
export function describeEdit(ops: readonly LoggedOp[], stored: ReadonlySet<string>): Line {
  if (ops.length === 0) return ['No change'];
  const record = (op: LoggedOp) => op.after ?? op.before;
  const of = (kind: LoggedOp['kind'], type?: SbdRecord['type']) => ops.filter((op) => op.kind === kind && (!type || record(op)?.type === type));
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
        const shot = found[0]?.after?.parentId ?? found[0]?.before?.parentId;
        const target = ops.find((op) => op.recordId === shot);
        return kind === 'create' ? ['Sketched on ', target ? nameOf(record(target)) : 'a frame'] : [`${kind === 'trash' ? 'Erased' : 'Restored'} ${plural(found.length, 'stroke')}`];
      }
      const first = found[0];
      if (found.length > 1 || !first) return [`${verb} ${plural(found.length, noun)}`];
      return type === 'note' ? [`${verb} a note`] : [`${verb} ${noun} `, nameOf(record(first))];
    }
  }
  const moves = of('move');
  const moved = moves[0];
  if (moved) return moves.length === 1 ? ['Moved ', nameOf(record(moved))] : [`Moved ${plural(moves.length, 'item')}`];
  const updates = ops.filter((op) => op.kind === 'update' && op.before && op.after);
  if (updates.length === 1 || new Set(updates.map((op) => op.recordId)).size === 1) {
    const op = updates[0];
    if (op?.before && op.after) {
      const changes = fieldChanges(op.before, op.after);
      const who = capitalise(nameOf(op.after));
      const [only] = changes;
      if (changes.length === 1 && only?.key !== undefined && (only.before === undefined || only.after === undefined)) {
        return [who, `: ${only.before === undefined ? 'added' : 'removed'} the field ${only.key}${tag}`];
      }
      if (changes.length === 1 && only) {
        return [who, `: ${changeLabel(only)} `, changeValuePart(only, only.before), ' → ', changeValuePart(only, only.after), tag];
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
export function describeGroup(group: OpGroup, ops: readonly LoggedOp[], titles: ReadonlyMap<string, Line>, stored: ReadonlySet<string>): Line {
  switch (group.kind) {
    case 'edit':
      return describeEdit(ops, stored);
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

/**
 * Every change to one item, newest first, field by field. Its number is listed too, though the board keeps it in
 * step and it isn't put back on its own, so an editor matching a slate can see when a frame was renumbered.
 */
export function frameRows(ops: readonly LoggedOp[]): FrameRow[] {
  return [...ops].reverse().flatMap((op, index): FrameRow[] => {
    const rows: FrameRow[] = [];
    const line = stepLine(op);
    if (line !== null) rows.push({ key: String(index), op, change: line, field: null });
    if (op.before && op.after) {
      for (const field of fieldChanges(op.before, op.after)) {
        rows.push({ key: `${String(index)}:${field.prop}:${field.key ?? ''}`, op, change: `${changeLabel(field)}${FIELD_HOW[op.groupKind]}`, field });
      }
    }
    // An update that changed nothing a person sees still happened: say so rather than drop it.
    if (rows.length === 0) rows.push({ key: String(index), op, change: KIND_LINE[op.kind], field: null });
    return rows;
  });
}
