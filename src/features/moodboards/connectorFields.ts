import type { JsonValue, SbdRecord } from '../../core/model/record';
import type { Head, LinkEnd, Route, Side } from '../../ui/canvas/types';

// A connector's props (5.2, docs/SBD_FORMAT.md, Boards): a `board_item` of kind `connector`. Read here whatever the file
// holds (an end that isn't one reads as no connector at all); nothing here touches the canvas or the project.

type Records = Readonly<Record<string, SbdRecord>>;

export const ROUTES: readonly Route[] = ['straight', 'elbow', 'curved'];
export const HEADS: readonly Head[] = ['none', 'arrow'];
export const SIDE_NAMES: readonly (Side | 'auto')[] = ['top', 'right', 'bottom', 'left', 'auto'];
export const DEFAULT_CONNECTOR_WIDTH = 1.5;
export const MIN_CONNECTOR_WIDTH = 0.5;
export const MAX_CONNECTOR_WIDTH = 24;

export interface ConnectorFields {
  from: LinkEnd;
  to: LinkEnd;
  route: Route;
  startHead: Head;
  endHead: Head;
  /** `#RRGGBB`, or null for the board's ink. */
  color: string | null;
  width: number;
  label: string;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const isObject = (value: unknown): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An end as stored: `{ item, side }` or `{ x, y }`. An unknown side reads as `auto`; anything else is no end. */
export function cleanEnd(value: unknown): LinkEnd | null {
  if (!isObject(value)) return null;
  if (typeof value.item === 'string' && value.item !== '') {
    const side = SIDE_NAMES.find((s) => s === value.side);
    return { item: value.item, side: side ?? 'auto' };
  }
  const x = num(value.x);
  const y = num(value.y);
  return x !== null && y !== null ? { x, y } : null;
}

export function cleanWidth(value: unknown): number {
  const n = num(value);
  return n === null || n <= 0 ? DEFAULT_CONNECTOR_WIDTH : Math.min(MAX_CONNECTOR_WIDTH, Math.max(MIN_CONNECTOR_WIDTH, n));
}

const colourOf = (value: unknown): string | null => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null);

/** A connector's props, or null when they aren't one this version can read. */
export function connectorFields(props: SbdRecord['props']): ConnectorFields | null {
  if (props.kind !== 'connector') return null;
  const from = cleanEnd(props.from);
  const to = cleanEnd(props.to);
  if (!from || !to) return null;
  return {
    from,
    to,
    route: ROUTES.find((r) => r === props.route) ?? 'straight',
    startHead: HEADS.find((h) => h === props.start_head) ?? 'none',
    endHead: HEADS.find((h) => h === props.end_head) ?? 'arrow',
    color: colourOf(props.color),
    width: cleanWidth(props.width),
    label: typeof props.label === 'string' ? props.label : '',
  };
}

export const isConnector = (record: SbdRecord | null | undefined): record is SbdRecord & { type: 'board_item' } => record?.type === 'board_item' && record.props.kind === 'connector';

export const attachedItems = (fields: ConnectorFields): string[] => [fields.from, fields.to].flatMap((end) => ('item' in end ? [end.item] : []));

/** An end as written to the file. */
export const endProps = (end: LinkEnd): Record<string, JsonValue> => ('item' in end ? { item: end.item, side: end.side } : { x: end.x, y: end.y });

/** Every connector, live or in the Trash, attached to any of these items: what deleting the items for good takes with them. */
export function connectorsAttachedToAny(records: readonly SbdRecord[], itemIds: readonly string[]): SbdRecord[] {
  const wanted = new Set(itemIds);
  return records.filter((r) => {
    const fields = isConnector(r) ? connectorFields(r.props) : null;
    return fields !== null && attachedItems(fields).some((id) => wanted.has(id));
  });
}

/** The live connectors attached to any of these items, whichever board: what trashing the items trashes with them. */
export function connectorsAttachedTo(records: Records, itemIds: readonly string[]): SbdRecord[] {
  const wanted = new Set(itemIds);
  return Object.values(records).filter((r) => {
    if (!isConnector(r) || r.trashedAt !== null) return false;
    const fields = connectorFields(r.props);
    return fields !== null && attachedItems(fields).some((id) => wanted.has(id));
  });
}
