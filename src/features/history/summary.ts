import { mediaFields } from '../../core/media/store';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { LoggedOp, OpGroup } from '../../core/ops/ops';

// What each step in History says (1.22): one line for an op group, in the board's words ("Added frame 4C", "4A: lens
// 35 → 50"), worked out from its ops' before and after. A drag that renumbers a scene is one step, "Moved 4B"; the
// renumbering it carried isn't listed apart. Undo, redo and restore name the step they went back to.

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

/** A value as a line of History shows it: short, and `—` for nothing. */
export function valueLabel(prop: string, value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  // Its text, where and how strong, so an old watermark can be told apart before it's put back.
  if (prop === 'watermark' && isObject(value)) {
    return `${watermarkPart('text', value.text)}, ${watermarkPart('position', value.position)}, ${watermarkPart('opacity', value.opacity)}`;
  }
  if (prop === 'lens_mm' && typeof value === 'number') return `${String(value)}mm`;
  if (prop === 't_stop' && typeof value === 'number') return `T${String(value)}`;
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  if (typeof value === 'object') return prop === 'custom' ? Object.keys(value).join(', ') || '—' : 'changed';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  const text = String(value).replace(/\s+/g, ' ');
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** The props an update changed, by name; numbers the board keeps in step itself are left out of a move. */
export function changedProps(before: SbdRecord, after: SbdRecord): string[] {
  const keys = new Set([...Object.keys(before.props), ...Object.keys(after.props)]);
  return [...keys].filter((key) => JSON.stringify(before.props[key]) !== JSON.stringify(after.props[key]));
}

/** How a record is named in a step: a frame by its number, a scene by its slate label. */
function nameOf(record: SbdRecord | null): string {
  if (!record) return 'an item';
  switch (record.type) {
    case 'shot':
      return shotFields(record.props).number || 'a frame';
    case 'scene':
      return sceneLabel(sceneFields(record.props).number);
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
export function describeEdit(ops: readonly LoggedOp[], stored: ReadonlySet<string>): string {
  if (ops.length === 0) return 'No change';
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
    return `Changed the theme${tag}`;
  }
  const watermark = ops.find((op) => record(op)?.type === 'project' && op.before && op.after && JSON.stringify(op.before.props.watermark) !== JSON.stringify(op.after.props.watermark));
  if (watermark) return `${describeWatermark(watermark.before?.props.watermark, watermark.after?.props.watermark)}${tag}`;

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
        return `${kind === 'create' ? 'Set the picture of' : verb === 'Deleted' ? 'Removed the picture of' : 'Restored the picture of'} ${nameOf(shot ? record(shot) : null)}${tag}`;
      }
      if (type === 'stroke') {
        const shot = found[0]?.after?.parentId ?? found[0]?.before?.parentId;
        const target = ops.find((op) => op.recordId === shot);
        return kind === 'create' ? `Sketched on ${target ? nameOf(record(target)) : 'a frame'}` : `${kind === 'trash' ? 'Erased' : 'Restored'} ${plural(found.length, 'stroke')}`;
      }
      const first = found[0];
      if (found.length > 1 || !first) return `${verb} ${plural(found.length, noun)}`;
      return type === 'note' ? `${verb} a note` : `${verb} ${noun} ${nameOf(record(first))}`;
    }
  }
  const moves = of('move');
  const moved = moves[0];
  if (moved) return moves.length === 1 ? `Moved ${nameOf(record(moved))}` : `Moved ${plural(moves.length, 'item')}`;
  const updates = ops.filter((op) => op.kind === 'update' && op.before && op.after);
  if (updates.length === 1 || new Set(updates.map((op) => op.recordId)).size === 1) {
    const op = updates[0];
    if (op?.before && op.after) {
      const props = changedProps(op.before, op.after);
      const who = nameOf(op.after);
      if (props.length === 1 && props[0]) {
        const prop = props[0];
        return `${capitalise(who)}: ${fieldLabel(prop)} ${valueLabel(prop, op.before.props[prop])} → ${valueLabel(prop, op.after.props[prop])}${tag}`;
      }
      return `${capitalise(who)}: ${props.map(fieldLabel).join(', ')}${tag}`;
    }
  }
  if (updates.length > 0) {
    // A renumber or a lock touches many frames: named by the scene they share when they share one.
    return `Changed ${plural(new Set(updates.map((op) => op.recordId)).size, 'item')}${tag}`;
  }
  return `${plural(ops.length, 'change')}${tag}`;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A step's line. Undo and redo say what they took back or did again; a restore, the point it went back to; Empty
 * Trash, how many items it deleted for good.
 */
export function describeGroup(group: OpGroup, ops: readonly LoggedOp[], titles: ReadonlyMap<string, string>, stored: ReadonlySet<string>): string {
  switch (group.kind) {
    case 'edit':
      return describeEdit(ops, stored);
    case 'undo':
      return `Undid: ${titles.get(group.targetGroupId ?? '') ?? 'a step'}`;
    case 'redo':
      return `Redid: ${titles.get(group.targetGroupId ?? '') ?? 'a step'}`;
    case 'restore':
      return group.restoreTo === null ? 'Restored the project to how it was created' : `Restored the project to: ${titles.get(group.restoreTo) ?? 'an earlier step'}`;
    case 'empty_trash':
      return `Emptied the Trash: ${plural(ops.length, 'item')} deleted for good`;
  }
}
