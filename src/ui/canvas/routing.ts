import { cornersOf, centreOf } from './hitTest';
import type { Geometry, LinkEnd, Point, Rect, Route, Side } from './types';

// Connector paths (5.2), pure: a path between two boxes or points, where a pointer snaps to an item, where an arrowhead
// points and how near a point is to a path. The canvas core stays board-agnostic: it routes between boxes and points and
// knows nothing of records. World units throughout, except where a name says screen pixels.

/** An end as the router sees it: a box (turned as it is) and the side it joins, or a point. */
export type Anchor = { box: Geometry; side: Side | 'auto' } | { point: Point };

/** A straight or bent line through points, or a cubic Bézier (its two ends and its two control points). */
export type Path = { kind: 'line'; points: Point[] } | { kind: 'curve'; points: [Point, Point, Point, Point] };

/** How far an elbow leaves an attached side before it may turn. */
export const STAND_OFF = 16;
/** How near the pointer must be to an item's box (screen pixels) to snap to it. */
export const SNAP_DISTANCE = 12;
/** How near the pointer must be to a connector's path (screen pixels) to pick it. */
export const PICK_DISTANCE = 6;
const CURVE_STEPS = 24;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const turn = (v: Point, degrees: number): Point => {
  const cos = Math.cos(radians(degrees));
  const sin = Math.sin(radians(degrees));
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
};
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const length = (a: Point): number => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** Each side's outward normal before the box is turned. */
const NORMAL: Readonly<Record<Side, Point>> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The middle of a side, after the box's rotation. */
export function sideMidpoint(box: Geometry, side: Side): Point {
  const n = NORMAL[side];
  const local = { x: (n.x * box.width) / 2, y: (n.y * box.height) / 2 };
  return add(centreOf(box), turn(local, box.rotation));
}

/** A side's outward normal after the box's rotation, as a unit vector. */
export const sideNormal = (box: Geometry, side: Side): Point => turn(NORMAL[side], box.rotation);

/** A world point in the box's own frame: its middle is the origin and its axes are the box's. */
function localOf(box: Geometry, point: Point): Point {
  return turn(sub(point, centreOf(box)), -box.rotation);
}

/** The side of a box a point lies towards, as the box is turned: the side the line from the box's middle to the point crosses. */
export function facingSide(box: Geometry, toward: Point): Side {
  const l = localOf(box, toward);
  const nx = l.x / (box.width / 2);
  const ny = l.y / (box.height / 2);
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? 'right' : 'left';
  return ny > 0 ? 'bottom' : 'top';
}

interface Resolved {
  point: Point;
  /** The way a line leaves, or null for a free end. */
  normal: Point | null;
}

/** Where an end is and which way it leaves; `other` is the other end's middle, which an `auto` side faces. */
function resolve(anchor: Anchor, other: Point): Resolved {
  if ('point' in anchor) return { point: anchor.point, normal: null };
  const side = anchor.side === 'auto' ? facingSide(anchor.box, other) : anchor.side;
  return { point: sideMidpoint(anchor.box, side), normal: sideNormal(anchor.box, side) };
}

const middleOf = (anchor: Anchor): Point => ('point' in anchor ? anchor.point : centreOf(anchor.box));

/** The point an end sits on, as drawn (for the end handles and a copy of a connector kept as a free end). */
export function endPoint(anchor: Anchor, other: Anchor): Point {
  return resolveBoth(anchor, other)[0].point;
}

type Axis = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** The right-angle direction nearest to a normal (an elbow has only right angles, whatever a box's turn). */
function axisOf(normal: Point): Axis {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) return { x: normal.x >= 0 ? 1 : -1, y: 0 };
  return { x: 0, y: normal.y >= 0 ? 1 : -1 };
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Without repeated points or points in the middle of a straight run (never where the line doubles back), so a count of segments is a count of turns. */
function tidyLine(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || !same(last, p)) out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i -= 1) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if (!a || !b || !c) continue;
    const straight = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6;
    if (straight && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0) out.splice(i, 1);
  }
  return out;
}

type Poly = readonly Point[];
const EDGE_INSET = 0.5;

/** Whether a segment passes through the inside of a convex polygon (touching its edge or corner doesn't count). */
export function crossesInside(a: Point, b: Point, poly: Poly): boolean {
  let low = 0;
  let high = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // The corners run clockwise on screen (y down), so an edge's direction turned left points outwards.
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i] as Point;
    const q = poly[(i + 1) % poly.length] as Point;
    const n = { x: q.y - p.y, y: p.x - q.x };
    const l = Math.hypot(n.x, n.y) || 1;
    const nx = n.x / l;
    const ny = n.y / l;
    // Inside is (point − p)·n ≤ −inset.
    const f0 = (a.x - p.x) * nx + (a.y - p.y) * ny + EDGE_INSET;
    const slope = dx * nx + dy * ny;
    if (Math.abs(slope) < 1e-9) {
      if (f0 > 0) return false;
    } else {
      const t = -f0 / slope;
      if (slope > 0) high = Math.min(high, t);
      else low = Math.max(low, t);
    }
    if (low >= high - 1e-9) return false;
  }
  return high - low > 1e-6;
}

const DIRS: readonly Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const dirIndex = (axis: Axis): number => DIRS.findIndex((d) => d.x === axis.x && d.y === axis.y);
const MAX_ELBOW_SEGMENTS = 5;
/** The most states an elbow search looks at before it gives up for a straight line. */
const MAX_EXPANSIONS = 2000;

interface Leg {
  point: Point;
  axis: Axis | null;
  /** How far an elbow runs along the axis before it may turn. */
  stand: number;
  box: Poly | null;
}

/** Whether a point is inside a convex polygon (edges excluded). */
function pointInside(p: Point, poly: Poly): boolean {
  return crossesInside({ x: p.x - 1e-3, y: p.y }, { x: p.x + 1e-3, y: p.y }, poly);
}

/**
 * Right angles from `s` to `e`, found as the fewest turns (then the shortest) over a grid of the coordinates that matter:
 * the two ends, a stand-off out of each attached side, the way round each box and the halves between. The first segment
 * leaves along the start side's normal, the last arrives along the end side's reverse, neither crosses a box it joins, and
 * there are at most five segments (out, across, along, across, in). Between two free ends: one bend.
 */
function elbow(s: Leg, e: Leg): Point[] {
  if (!s.axis && !e.axis) return tidyLine([s.point, { x: e.point.x, y: s.point.y }, e.point]);
  const boxes = [s.box, e.box].filter((b): b is Poly => b !== null);
  const xs = new Set<number>([s.point.x, e.point.x, (s.point.x + e.point.x) / 2]);
  const ys = new Set<number>([s.point.y, e.point.y, (s.point.y + e.point.y) / 2]);
  const stands: Point[] = [];
  for (const leg of [s, e]) {
    if (!leg.axis) continue;
    const out = { x: leg.point.x + leg.axis.x * leg.stand, y: leg.point.y + leg.axis.y * leg.stand };
    stands.push(out);
    xs.add(out.x);
    ys.add(out.y);
  }
  for (const box of boxes) {
    for (const c of box) {
      xs.add(c.x - STAND_OFF);
      xs.add(c.x + STAND_OFF);
      ys.add(c.y - STAND_OFF);
      ys.add(c.y + STAND_OFF);
    }
  }
  if (stands.length === 2) {
    xs.add((stands[0] as Point).x / 2 + (stands[1] as Point).x / 2);
    ys.add((stands[0] as Point).y / 2 + (stands[1] as Point).y / 2);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  // A turn may not happen within a stand-off of an attached end: those grid points on the end's own line are left out.
  const keepOut = (p: Point, leg: Leg): boolean => {
    if (!leg.axis) return false;
    const along = (p.x - leg.point.x) * leg.axis.x + (p.y - leg.point.y) * leg.axis.y;
    const across = Math.abs((p.x - leg.point.x) * leg.axis.y) + Math.abs((p.y - leg.point.y) * leg.axis.x);
    return across < 1e-6 && along > 1e-6 && along < leg.stand - 1e-6;
  };
  const valid = (i: number, j: number): boolean => {
    const p = { x: X[i] as number, y: Y[j] as number };
    if (same(p, s.point) || same(p, e.point)) return true;
    return !boxes.some((box) => pointInside(p, box)) && !keepOut(p, s) && !keepOut(p, e);
  };
  const at = (p: Point, list: number[], key: 'x' | 'y') => list.findIndex((v) => Math.abs(v - p[key]) < 1e-6);
  const si = at(s.point, X, 'x');
  const sj = at(s.point, Y, 'y');
  const ei = at(e.point, X, 'x');
  const ej = at(e.point, Y, 'y');
  const ok = X.map((_, i) => Y.map((__, j) => valid(i, j)));
  // The next valid grid point from (i, j) in a direction.
  const next = (i: number, j: number, d: number): [number, number] | null => {
    const di = DIRS[d]?.x ?? 0;
    const dj = DIRS[d]?.y ?? 0;
    for (let a = i + di, b = j + dj; a >= 0 && a < X.length && b >= 0 && b < Y.length; a += di, b += dj) {
      if (ok[a]?.[b]) return [a, b];
    }
    return null;
  };
  const wantFirst = s.axis ? dirIndex(s.axis) : -1;
  const wantLast = e.axis ? (dirIndex(e.axis) + 2) % 4 : -1;
  const mid = { x: (s.point.x + e.point.x) / 2, y: (s.point.y + e.point.y) / 2 };
  interface Node {
    i: number;
    j: number;
    dir: number;
    turns: number;
    cost: number;
    from: Node | null;
  }
  // An end, or the point a stand-off out of it, buried in a box it doesn't belong to has no way out: a straight line, at once.
  const buried = (p: Point, own: Poly | null) => boxes.some((box) => box !== own && pointInside(p, box));
  if (buried(s.point, s.box) || buried(e.point, e.box)) return [s.point, e.point];
  for (const leg of [s, e]) {
    const axis = leg.axis;
    if (axis && boxes.some((box) => pointInside({ x: leg.point.x + axis.x * leg.stand, y: leg.point.y + axis.y * leg.stand }, box))) {
      return [s.point, e.point];
    }
  }
  // Fewest turns first, then the shortest (a turn near the middle of the two ends wins among equals): a binary heap ordered
  // by (turns, length), a state kept only if it beats the best way found to it, and a cap on the work.
  const before = (x: Node, y: Node) => x.turns < y.turns || (x.turns === y.turns && x.cost < y.cost);
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    for (let c = heap.length - 1; c > 0; ) {
      const p = (c - 1) >> 1;
      if (!before(heap[c] as Node, heap[p] as Node)) break;
      [heap[c], heap[p]] = [heap[p] as Node, heap[c] as Node];
      c = p;
    }
  };
  const pop = (): Node => {
    const top = heap[0] as Node;
    const last = heap.pop() as Node;
    if (heap.length > 0) {
      heap[0] = last;
      for (let c = 0; ; ) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && before(heap[l] as Node, heap[m] as Node)) m = l;
        if (r < heap.length && before(heap[r] as Node, heap[m] as Node)) m = r;
        if (m === c) break;
        [heap[c], heap[m]] = [heap[m] as Node, heap[c] as Node];
        c = m;
      }
    }
    return top;
  };
  const best = new Map<string, number>();
  const keyOf = (n: Node) => `${String(n.i)},${String(n.j)},${String(n.dir)},${String(n.turns)}`;
  const offer = (n: Node) => {
    const key = keyOf(n);
    const had = best.get(key);
    if (had !== undefined && had <= n.cost) return;
    best.set(key, n.cost);
    push(n);
  };
  offer({ i: si, j: sj, dir: -1, turns: 0, cost: 0, from: null });
  let found: Node | null = null;
  let expanded = 0;
  while (heap.length > 0 && expanded < MAX_EXPANSIONS) {
    const node = pop();
    if ((best.get(keyOf(node)) as number) < node.cost) continue;
    expanded += 1;
    if (node.i === ei && node.j === ej && node.dir !== -1 && (wantLast === -1 || node.dir === wantLast)) {
      found = node;
      break;
    }
    for (let d = 0; d < 4; d += 1) {
      if (node.dir === -1 && wantFirst !== -1 && d !== wantFirst) continue;
      if (node.dir !== -1 && d === (node.dir + 2) % 4) continue;
      const to = next(node.i, node.j, d);
      if (!to) continue;
      const turn = node.dir !== -1 && d !== node.dir;
      const turns = node.turns + (turn ? 1 : 0);
      if (turns + 1 > MAX_ELBOW_SEGMENTS) continue;
      const a = { x: X[node.i] as number, y: Y[node.j] as number };
      const b = { x: X[to[0]] as number, y: Y[to[1]] as number };
      if (boxes.some((box) => crossesInside(a, b, box))) continue;
      const nudge = turn ? 1e-4 * (Math.abs(a.x - mid.x) + Math.abs(a.y - mid.y)) : 0;
      offer({ i: to[0], j: to[1], dir: d, turns, cost: node.cost + Math.hypot(b.x - a.x, b.y - a.y) + nudge, from: node });
    }
  }
  if (!found) return [s.point, e.point];
  const out: Point[] = [];
  for (let n: Node | null = found; n; n = n.from) out.push({ x: X[n.i] as number, y: Y[n.j] as number });
  return tidyLine(out.reverse());
}

/** Both ends, resolved: a fixed side or a free point first, then an `auto` side facing the other end as it is drawn. */
function resolveBoth(from: Anchor, to: Anchor): [Resolved, Resolved] {
  const fixed = (a: Anchor) => 'point' in a || a.side !== 'auto';
  const a0 = fixed(from) ? resolve(from, middleOf(to)) : null;
  const b0 = fixed(to) ? resolve(to, middleOf(from)) : null;
  const a = a0 ?? resolve(from, b0 ? b0.point : middleOf(to));
  const b = b0 ?? resolve(to, a0 ? a0.point : middleOf(from));
  return [a, b];
}

/** The path between two ends. */
export function routeBetween(from: Anchor, to: Anchor, route: Route): Path {
  const [a, b] = resolveBoth(from, to);
  if (route === 'elbow') {
    const sa = a.normal ? axisOf(a.normal) : null;
    const sb = b.normal ? axisOf(b.normal) : null;
    // Facing sides closer than two stand-offs split the room: each leaves by half of it.
    let standA = STAND_OFF;
    let standB = STAND_OFF;
    if (sa && sb && sa.x === -sb.x && sa.y === -sb.y) {
      const gap = (b.point.x - a.point.x) * sa.x + (b.point.y - a.point.y) * sa.y;
      if (gap > 0 && gap < 2 * STAND_OFF) {
        standA = gap / 2;
        standB = gap / 2;
      }
    }
    const polyOf = (anchor: Anchor): Poly | null => ('box' in anchor ? cornersOf(anchor.box) : null);
    return {
      kind: 'line',
      points: elbow({ point: a.point, axis: sa, stand: standA, box: polyOf(from) }, { point: b.point, axis: sb, stand: standB, box: polyOf(to) }),
    };
  }
  if (route === 'curved') {
    const d = length(sub(b.point, a.point));
    // An attached end leaves along its side's normal by a third of the distance; a free end aims at the other end.
    const c1 = a.normal ? add(a.point, scale(a.normal, d / 3)) : add(a.point, scale(sub(b.point, a.point), 1 / 3));
    const c2 = b.normal ? add(b.point, scale(b.normal, d / 3)) : add(b.point, scale(sub(a.point, b.point), 1 / 3));
    return { kind: 'curve', points: [a.point, c1, c2, b.point] };
  }
  return { kind: 'line', points: [a.point, b.point] };
}

const bezier = (p: [Point, Point, Point, Point], t: number): Point => {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return {
    x: w[0] * p[0].x + w[1] * p[1].x + w[2] * p[2].x + w[3] * p[3].x,
    y: w[0] * p[0].y + w[1] * p[1].y + w[2] * p[2].y + w[3] * p[3].y,
  };
};

/** The path as straight pieces: a curve sampled 24 times. */
export function flatten(path: Path): Point[] {
  if (path.kind === 'line') return path.points;
  return Array.from({ length: CURVE_STEPS + 1 }, (_, i) => bezier(path.points, i / CURVE_STEPS));
}

/** How many straight pieces a line has (a curve has none worth counting). */
export const segmentCount = (path: Path): number => (path.kind === 'line' ? Math.max(0, path.points.length - 1) : 1);

/**
 * The way an arrowhead at each end points: at the end, along the last segment; at the start, back along the first (away
 * from the line, so a head there points out of it). Unit vectors.
 */
export function headDirections(path: Path): { start: Point; end: Point } {
  if (path.kind === 'curve') {
    // A control point on top of its end (a zero-length connector) has no direction; fall back to the chord.
    const [p0, c1, c2, p3] = path.points;
    const start = unit(sub(p0, same(c1, p0) ? p3 : c1));
    const end = unit(sub(p3, same(c2, p3) ? p0 : c2));
    return { start, end };
  }
  const pts = path.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return { start: { x: -1, y: 0 }, end: { x: 1, y: 0 } };
  const second = pts[1] ?? last;
  const before = pts[pts.length - 2] ?? first;
  return { start: unit(sub(first, second)), end: unit(sub(last, before)) };
}

/** The point half way along the path's length: where the label sits. */
export function pathMiddle(path: Path): Point {
  const pts = flatten(path);
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += length(sub(pts[i] as Point, pts[i - 1] as Point));
  let left = total / 2;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const l = length(sub(b, a));
    if (left <= l && l > 0) return add(a, scale(sub(b, a), left / l));
    left -= l;
  }
  return pts[0] as Point;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return length(sub(p, add(a, scale(ab, t))));
}

/** How far a point is from the path. */
export function distanceToPath(path: Path, point: Point): number {
  const pts = flatten(path);
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) best = Math.min(best, distanceToSegment(point, pts[i - 1] as Point, pts[i] as Point));
  if (pts.length === 1) best = length(sub(point, pts[0] as Point));
  return best;
}

/** Whether a point is within `reach` of the path. */
export const pathHits = (path: Path, point: Point, reach: number): boolean => distanceToPath(path, point) <= reach;

const inside = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const ccw = (a: Point, b: Point, c: Point) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const crosses = (a: Point, b: Point, c: Point, d: Point) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

/** Whether a marquee touches the path: any part of it inside, or crossing an edge. */
export function pathTouchesRect(path: Path, rect: Rect): boolean {
  const pts = flatten(path);
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  if (pts.some((p) => inside(rect, p))) return true;
  for (let i = 1; i < pts.length; i += 1) {
    for (let k = 0; k < 4; k += 1) {
      if (crosses(pts[i - 1] as Point, pts[i] as Point, corners[k] as Point, corners[(k + 1) % 4] as Point)) return true;
    }
  }
  return false;
}

/** The upright rectangle round the path. */
export function pathBounds(path: Path): Rect {
  const pts = flatten(path);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export interface Snap {
  /** The end the pointer makes: attached to an item, else free at the pointer. */
  end: LinkEnd;
  /** Where the attached side's middle is, to show it (an `auto` end shows the item's middle); null when free. */
  mark: Point | null;
}

/** How far a point is from a box (0 inside it), as the box is turned. */
function distanceToBox(box: Geometry, point: Point): number {
  const l = localOf(box, point);
  return Math.hypot(Math.max(Math.abs(l.x) - box.width / 2, 0), Math.max(Math.abs(l.y) - box.height / 2, 0));
}

/**
 * Where a pointer joins: within 12 screen px of an item's box it snaps to the item, to the side nearest the pointer, or
 * `auto` over the box's middle third; otherwise it is free at the pointer. `boxes` run back to front, the topmost wins a
 * tie; `skip` is an item that can't be joined (the connector's own other end).
 */
export function snapEnd(boxes: readonly { id: string; box: Geometry }[], point: Point, zoom: number, skip: string | null = null): Snap {
  const reach = SNAP_DISTANCE / zoom;
  let best: { id: string; box: Geometry; d: number } | null = null;
  for (const { id, box } of boxes) {
    if (id === skip) continue;
    const d = distanceToBox(box, point);
    if (d <= reach && (best === null || d <= best.d)) best = { id, box, d };
  }
  if (!best) return { end: { x: point.x, y: point.y }, mark: null };
  const l = localOf(best.box, point);
  if (Math.abs(l.x) <= best.box.width / 6 && Math.abs(l.y) <= best.box.height / 6) return { end: { item: best.id, side: 'auto' }, mark: centreOf(best.box) };
  const side = facingSide(best.box, point);
  return { end: { item: best.id, side }, mark: sideMidpoint(best.box, side) };
}

/** How big an arrowhead is for a line of this width. */
export const headSize = (width: number): number => Math.min(STAND_OFF, 8 + width * 3);

/** The three points of an arrowhead whose tip is at `tip` and points along `direction`. */
export function headPoints(tip: Point, direction: Point, width: number): [Point, Point, Point] {
  const size = headSize(width);
  const back = sub(tip, scale(direction, size));
  const across = { x: -direction.y, y: direction.x };
  // Only the length is capped; the base is at least twice the line's width, so a thick line never shows past its head.
  const half = Math.max(size * 0.45, width);
  return [tip, add(back, scale(across, half)), sub(back, scale(across, half))];
}

/** The box a connector's label takes at the path's middle: an estimate from its words (nothing is measured here). */
export function labelBox(text: string, middle: Point, fontSize: number, minimumWidth = 0): Rect {
  const lines = text === '' ? [''] : text.split('\n');
  const widest = Math.max(...lines.map((l) => l.length));
  const width = Math.max(minimumWidth, Math.ceil(widest * fontSize * 0.6 + 16));
  const height = Math.ceil(lines.length * fontSize * 1.2 + 8);
  return { x: middle.x - width / 2, y: middle.y - height / 2, width, height };
}

/** A polyline with `cut` taken off its start, along however many segments that takes. */
function cutStart(points: readonly Point[], cut: number): Point[] {
  let left = cut;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const l = length(sub(b, a));
    if (left < l) return [add(a, scale(sub(b, a), left / l)), ...points.slice(i)];
    left -= l;
  }
  return [...points];
}

const lengthOf = (points: readonly Point[]): number => points.reduce((sum, p, i) => (i === 0 ? 0 : sum + length(sub(p, points[i - 1] as Point))), 0);

const lerp = (a: Point, b: Point, t: number): Point => add(a, scale(sub(b, a), t));

/** The part of a Bézier between two parameters, as a Bézier. */
function subCurve(p: [Point, Point, Point, Point], t0: number, t1: number): [Point, Point, Point, Point] {
  const split = (q: [Point, Point, Point, Point], t: number): [[Point, Point, Point, Point], [Point, Point, Point, Point]] => {
    const ab = lerp(q[0], q[1], t);
    const bc = lerp(q[1], q[2], t);
    const cd = lerp(q[2], q[3], t);
    const abc = lerp(ab, bc, t);
    const bcd = lerp(bc, cd, t);
    const mid = lerp(abc, bcd, t);
    return [[q[0], ab, abc, mid], [mid, bcd, cd, q[3]]];
  };
  const [head] = split(p, t1);
  if (t1 === 0) return head;
  return split(head, t0 / t1)[1];
}

/** The parameter at which a curve's length from its start (or, reversed, its end) is `distance`, by the 24-step sampling. */
function curveParameter(p: [Point, Point, Point, Point], distance: number, fromEnd: boolean): number {
  const samples = Array.from({ length: CURVE_STEPS + 1 }, (_, i) => bezier(p, fromEnd ? 1 - i / CURVE_STEPS : i / CURVE_STEPS));
  let left = distance;
  for (let i = 1; i < samples.length; i += 1) {
    const l = length(sub(samples[i] as Point, samples[i - 1] as Point));
    if (left < l) {
      const u = left / l;
      const t = (i - 1 + u) / CURVE_STEPS;
      return fromEnd ? 1 - t : t;
    }
    left -= l;
  }
  return fromEnd ? 0 : 1;
}

/**
 * The path with `startCut` taken off its start and `endCut` off its end, so a line ends under an arrowhead instead of
 * beside its tip (curves too). Never more than 45% of the path from either end.
 */
export function trimmed(path: Path, startCut: number, endCut: number): Path {
  if (path.kind === 'curve') {
    const total = lengthOf(flatten(path));
    const t0 = startCut > 0 ? curveParameter(path.points, Math.min(startCut, total * 0.45), false) : 0;
    const t1 = endCut > 0 ? curveParameter(path.points, Math.min(endCut, total * 0.45), true) : 1;
    return { kind: 'curve', points: subCurve(path.points, t0, Math.max(t0 + 1e-6, t1)) };
  }
  const total = lengthOf(path.points);
  let points = path.points;
  if (startCut > 0) points = cutStart(points, Math.min(startCut, total * 0.45));
  if (endCut > 0) points = cutStart([...points].reverse(), Math.min(endCut, total * 0.45)).reverse();
  return { kind: 'line', points };
}
