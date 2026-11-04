import type { SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';

// A frame's sketch (1.13): each stroke is its own `stroke` record under the shot, so the History, which keeps whole
// records, never copies every earlier stroke into each new one (decided Nov 2). Points are fractions of the frame
// (0 to 1 across and down) and widths fractions of its height, so a sketch fits whatever size the frame is drawn at.
// A stroke keeps per-point pressure only when the pointer really has it (a pen or a Pencil); a mouse or a finger
// draws at one width.

type Records = Readonly<Record<string, SbdRecord>>;

export const SKETCH_TOOLS = ['pen', 'arrow', 'box'] as const;
export type SketchTool = (typeof SKETCH_TOOLS)[number];

/** Line widths, as fractions of the frame's height: a pencil line, a marker and a bold one. */
export const WIDTHS = { thin: 0.004, medium: 0.008, bold: 0.016 } as const;
export type WidthName = keyof typeof WIDTHS;

export interface Stroke {
  id: string;
  tool: SketchTool;
  /** x, y, x, y… as fractions of the frame. An arrow or a box has two points: start and end, or two corners. */
  points: number[];
  width: number;
  /** One per point, 0 to 1, when the pointer reported real pressure. */
  pressures: number[] | null;
}

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n));

/** A stroke record's drawing, or null for props it can't read. */
export function readStroke(record: SbdRecord): Stroke | null {
  const { tool, points, width, pressures } = record.props;
  if (!(SKETCH_TOOLS as readonly unknown[]).includes(tool) || !isNumberArray(points) || points.length < 4) return null;
  if (typeof width !== 'number' || !(width > 0)) return null;
  return {
    id: record.id,
    tool: tool as SketchTool,
    points,
    width,
    pressures: isNumberArray(pressures) && pressures.length * 2 === points.length ? pressures : null,
  };
}

/** Every shot's live strokes at once, by shot, in the order they were drawn: one pass, for a whole board. */
export function strokesByShot(records: Records): Map<string, Stroke[]> {
  const live = Object.values(records)
    .filter((r) => r.type === 'stroke' && r.trashedAt === null && r.parentId !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const out = new Map<string, Stroke[]>();
  for (const record of live) {
    const stroke = readStroke(record);
    if (!stroke || !record.parentId) continue;
    const list = out.get(record.parentId) ?? [];
    list.push(stroke);
    out.set(record.parentId, list);
  }
  return out;
}

/** Each shot's list as last handed out, with the stroke ids it was made from. */
const handedOut = new Map<string, { key: string; strokes: Stroke[] }>();

/**
 * strokesByShot for a board that redraws on every edit: a shot whose strokes are unchanged gets the same list as last
 * time, so its card's sketch (memoised) doesn't redraw. A stroke never changes once drawn, only comes or goes, so the
 * ids say whether a list is the same.
 */
export function stableStrokesByShot(records: Records): Map<string, Stroke[]> {
  const next = strokesByShot(records);
  for (const [shotId, strokes] of next) {
    const key = strokes.map((stroke) => stroke.id).join(',');
    const before = handedOut.get(shotId);
    if (before?.key === key) next.set(shotId, before.strokes);
    else handedOut.set(shotId, { key, strokes });
  }
  return next;
}

/** A shot's live strokes, in the order they were drawn. */
export function strokesOf(records: Records, shotId: string): Stroke[] {
  return Object.values(records)
    .filter((r) => r.type === 'stroke' && r.parentId === shotId && r.trashedAt === null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map(readStroke)
    .filter((stroke): stroke is Stroke => stroke !== null);
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Points as stored: rounded to a ten-thousandth of the frame (a fraction of a pixel on a 4K screen) and thinned, so a
 * fast scribble doesn't store a point per pixel. Pressures follow the points they belong to.
 */
export function tidyPoints(points: readonly number[], pressures: readonly number[] | null): { points: number[]; pressures: number[] | null } {
  const kept: number[] = [];
  const keptPressures: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = round(points[i] ?? 0, 4);
    const y = round(points[i + 1] ?? 0, 4);
    const last = kept.length - 2;
    const isLast = i + 2 >= points.length;
    if (last >= 0 && !isLast && Math.hypot(x - (kept[last] ?? 0), y - (kept[last + 1] ?? 0)) < 0.002) continue;
    kept.push(x, y);
    if (pressures) keptPressures.push(round(pressures[i / 2] ?? 0.5, 2));
  }
  return { points: kept, pressures: pressures ? keptPressures : null };
}

/** The create op for a new stroke, after the shot's last one. */
export function addStroke(records: Records, shotId: string, stroke: Omit<Stroke, 'id'>): Extract<Change, { kind: 'create' }> {
  const last = Object.values(records)
    .filter((r) => r.type === 'stroke' && r.parentId === shotId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  return {
    kind: 'create',
    record: {
      id: crypto.randomUUID(),
      type: 'stroke',
      parentId: shotId,
      sortKey: keyBetween(last, null),
      props: {
        tool: stroke.tool,
        points: stroke.points,
        width: stroke.width,
        ...(stroke.pressures ? { pressures: stroke.pressures } : {}),
      },
    },
  };
}

/** Strokes taken off by the eraser or Clear: to the Trash, all in one op group, so one undo brings them back. */
export function eraseStrokes(ids: Iterable<string>): Change[] {
  return [...new Set(ids)].map((id) => ({ kind: 'trash', id }));
}

/** Distance from a point to a segment, in frame fractions with the frame's shape taken into account. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number, aspect: number): number {
  // Measured in units of the frame's height, so across and down count the same.
  const [x, y, x1, y1, x2, y2] = [px * aspect, py, ax * aspect, ay, bx * aspect, by];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** The segments a stroke draws, as x1, y1, x2, y2: its path, or a box's four sides. */
function segments(stroke: Stroke): number[][] {
  const p = stroke.points;
  if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
    return [
      [x1, y1, x2, y1],
      [x2, y1, x2, y2],
      [x2, y2, x1, y2],
      [x1, y2, x1, y1],
    ];
  }
  const out: number[][] = [];
  for (let i = 0; i + 3 < p.length; i += 2) out.push([p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0, p[i + 3] ?? 0]);
  return out;
}

/** The strokes the eraser touches at a point: within `radius` (a fraction of the frame's height) of any of its lines. */
export function strokesAt(strokes: readonly Stroke[], x: number, y: number, radius: number, aspect: number): string[] {
  return strokes
    .filter((stroke) =>
      segments(stroke).some(
        ([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => segmentDistance(x, y, x1, y1, x2, y2, aspect) <= radius + stroke.width / 2,
      ),
    )
    .map((stroke) => stroke.id);
}

/**
 * The outline of a stroke drawn with pressure, as a polygon in pixels: each point pushed out either side by half its
 * width, down one side and back up the other. Width goes from 40% at the lightest touch to 160% at the firmest.
 */
export function pressureOutline(points: readonly number[], pressures: readonly number[], width: number, height: number, baseWidth: number): number[] {
  const n = Math.floor(points.length / 2);
  const at = (i: number) => [(points[2 * i] ?? 0) * width, (points[2 * i + 1] ?? 0) * height] as const;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const [x, y] = at(i);
    const [px, py] = at(Math.max(0, i - 1));
    const [nx, ny] = at(Math.min(n - 1, i + 1));
    const dx = nx - px;
    const dy = ny - py;
    const length = Math.hypot(dx, dy) || 1;
    const half = (baseWidth * height * (0.4 + 1.2 * (pressures[i] ?? 0.5))) / 2;
    left.push(x - (dy / length) * half, y + (dx / length) * half);
    right.push(x + (dy / length) * half, y - (dx / length) * half);
  }
  const back: number[] = [];
  for (let i = right.length - 2; i >= 0; i -= 2) back.push(right[i] ?? 0, right[i + 1] ?? 0);
  return [...left, ...back];
}

/** An arrow's head as a triangle in pixels: two barbs back from the tip, sized by the line's width. */
export function arrowHead(points: readonly number[], width: number, height: number, lineWidth: number): number[] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
  const [ax, ay, bx, by] = [x1 * width, y1 * height, x2 * width, y2 * height];
  const angle = Math.atan2(by - ay, bx - ax);
  const length = Math.max(lineWidth * height * 4, 8);
  const spread = Math.PI / 7;
  return [
    bx,
    by,
    bx - length * Math.cos(angle - spread),
    by - length * Math.sin(angle - spread),
    bx - length * Math.cos(angle + spread),
    by - length * Math.sin(angle + spread),
  ];
}
