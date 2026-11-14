// What each plan icon draws, as plain data (6.3, third review round), written to src/features/birdseye/plan/iconBoxes.ts
// so the plan draws every icon as vectors, the same in every engine, with or without a page: its shapes as paths on the
// kit's 32 px grid (every rect, circle, ellipse, line, polyline and polygon turned into path data, any transform already
// applied, circles and ellipses kept as arcs), each with the kit's own paint, and its texts; and the box of its ink.
// Run it by hand after the kit's icons change, from the repo's root:
//
//   node scripts/planIconBoxes.ts
//
// The box is the bare geometry of what an icon draws, no stroke padding at all: the plan draws an icon's lines at the
// kit's weight in screen pixels at every zoom (non-scaling strokes), so a padding counted in the grid would be right at
// one zoom only. Strokes straddle the box's edge, as they do in any drawing. A text counts as a nominal box at its x and
// y (a monospace face's advance, 0.6 em a character, from its cap height to its descent).
//
// It reads only what it can draw exactly and throws, naming the file, on anything else: an element outside {svg, title,
// desc, rect, circle, ellipse, line, polyline, polygon, path, text} (a group, defs, use), an attribute it doesn't know, a
// length that isn't a plain number (a unit, a percentage), a single-quoted attribute, an arc flag that isn't 0 or 1, a
// zero-length arc, a transform other than rotate and translate, or a box that isn't a number. Never a silent zero.
// A Vitest test (src/features/birdseye/plan/iconBoxes.test.ts) runs it again and checks the table is current.
// Plain TypeScript Node runs as is (type stripping, Node 22.18 and later): no enums, no imports but Node's.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface IconBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

/** One shape of an icon as a path on the 32 px grid, its transform applied, with the kit's paint. */
export interface IconPath {
  kind: 'path';
  d: string;
  /** The kit's hex, or null for none. */
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeOpacity: number;
  /** Grid pixels, which the plan draws as screen pixels. */
  strokeWidth: number;
  dash: number[] | null;
  lineCap: LineCap;
  lineJoin: LineJoin;
  opacity: number;
}

/** A text of an icon: its baseline at x, y on the grid, anchored as SVG's text-anchor says, in a bundled face. */
export interface IconText {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  anchor: 'start' | 'middle' | 'end';
  family: string;
  weight: number;
  fill: string;
  fillOpacity: number;
  opacity: number;
}

export type IconPart = IconPath | IconText;

export interface IconDrawing {
  box: IconBox;
  shapes: IconPart[];
}

interface Pt {
  x: number;
  y: number;
}

const GRID = 32;

/** The faces the app bundles and the canvas can draw an icon's text in. */
const FACES = ['JetBrains Mono', 'Inter Tight'];

const ELEMENTS = new Set(['title', 'desc', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text']);

/** Paint and type attributes, which a shape takes from the root unless it sets its own. */
const PRESENTATION = new Set([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'font-family',
  'font-weight',
  'font-size',
  'text-anchor',
]);

const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  path: ['d'],
  text: ['x', 'y'],
};

const ROOT_ONLY = new Set(['xmlns', 'width', 'height', 'viewBox']);

/** A tag's attributes, every one double-quoted and read whole: anything else throws. */
function attrsOf(source: string, tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let rest = source;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest === '') return out;
    const m = /^([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(rest);
    if (!m) throw new Error(`<${tag}> has an attribute that can't be read: "${rest.slice(0, 24)}"`);
    const name = m[1] ?? '';
    if (m[4] !== undefined) throw new Error(`<${tag}> has a single-quoted attribute ${name}`);
    if (Object.hasOwn(out, name)) throw new Error(`<${tag}> sets ${name} twice`);
    out[name] = m[3] ?? '';
    rest = rest.slice(m[0].length);
  }
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** A plain number, or a throw naming what it was for: a unit or a percentage is not read. */
function num(value: string, what: string): number {
  const v = value.trim();
  if (!NUMBER.test(v)) throw new Error(`${what} "${value}" isn't a plain number`);
  const out = Number(v);
  if (!Number.isFinite(out)) throw new Error(`${what} "${value}" isn't a number`);
  return out;
}

/** An attribute's number, its default when it is absent, or a throw when it is required and absent. */
function numAttr(a: Readonly<Record<string, string>>, name: string, tag: string, fallback?: number): number {
  const value = a[name];
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`<${tag}> has no ${name}`);
    return fallback;
  }
  return num(value, `<${tag}> ${name}`);
}

function paint(value: string, what: string): string | null {
  const v = value.trim();
  if (v === 'none') return null;
  if (/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v)) return v;
  throw new Error(`${what} "${value}" isn't a hex colour or none`);
}

function opacity(value: string, what: string): number {
  return Math.min(1, Math.max(0, num(value, what)));
}

/** A style attribute's declarations, as presentation attributes (CSS wins over them, as in a browser). */
function styleOf(value: string, tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    if (part.trim() === '') continue;
    const at = part.indexOf(':');
    const name = at < 0 ? '' : part.slice(0, at).trim();
    if (!PRESENTATION.has(name)) throw new Error(`<${tag}> style "${part.trim()}" can't be read`);
    out[name] = part.slice(at + 1).trim();
  }
  return out;
}

/** An affine transform [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
/** How far a transform turns, degrees (only rotations and moves are read, so it never scales or skews). */
const turnOf = (m: Matrix): number => (Math.atan2(m[1], m[0]) * 180) / Math.PI;

/** A shape's transform: rotate(a [cx cy]) and translate(x [y]); anything else throws. */
function transformOf(value: string | undefined, tag: string): Matrix {
  if (value === undefined) return IDENTITY;
  let rest = value.trim();
  let m = IDENTITY;
  while (rest !== '') {
    const step = /^(\w+)\s*\(([^)]*)\)\s*,?\s*/.exec(rest);
    if (!step) throw new Error(`<${tag}> transform "${value}" can't be read`);
    const name = step[1] ?? '';
    const args = (step[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map((s) => num(s, `<${tag}> ${name}`));
    let next: Matrix;
    if (name === 'translate' && (args.length === 1 || args.length === 2)) next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    else if (name === 'rotate' && (args.length === 1 || args.length === 3)) {
      const a = ((args[0] ?? 0) * Math.PI) / 180;
      const cx = args[1] ?? 0;
      const cy = args[2] ?? 0;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      next = [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos];
    } else throw new Error(`<${tag}> transform ${name}(${step[2] ?? ''}) can't be read`);
    // The list applies right to left, as SVG has it: the leftmost is outermost.
    m = times(m, next);
    rest = rest.slice(step[0].length);
  }
  return m;
}

const SAMPLES = 96;

/** An elliptical arc's points, from SVG's endpoint form (SVG 1.1, F.6.5), sampled. */
function arcPoints(from: Pt, rxIn: number, ryIn: number, xRotation: number, large: boolean, sweep: boolean, to: Pt): Pt[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [to];
  const phi = (xRotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const a = start + (delta * i) / SAMPLES;
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy };
  });
}

/** A cubic or quadratic Bézier's points, sampled. */
function bezierPoints(controls: readonly Pt[]): Pt[] {
  const at = (t: number): Pt => {
    let pts = [...controls];
    while (pts.length > 1) pts = pts.slice(1).map((p, i) => ({ x: (pts[i]?.x ?? 0) * (1 - t) + p.x * t, y: (pts[i]?.y ?? 0) * (1 - t) + p.y * t }));
    return pts[0] ?? { x: 0, y: 0 };
  };
  return Array.from({ length: SAMPLES + 1 }, (_, i) => at(i / SAMPLES));
}

/** A path's segments, every one absolute: H and V as L, S as C, T as Q; an arc with a zero radius is a line, as SVG has it. */
type Segment =
  | { k: 'M'; p: Pt }
  | { k: 'L'; p: Pt }
  | { k: 'C'; c1: Pt; c2: Pt; p: Pt }
  | { k: 'Q'; c: Pt; p: Pt }
  | { k: 'A'; rx: number; ry: number; turn: number; large: boolean; sweep: boolean; p: Pt }
  | { k: 'Z' };

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** A path's data read into absolute segments; anything it can't read throws. */
export function pathSegments(d: string): Segment[] {
  if (!/^[\s,]*$/.test(d.replace(TOKEN, ' '))) throw new Error(`path "${d}" has something that can't be read`);
  const tokens = d.match(TOKEN) ?? [];
  const out: Segment[] = [];
  let i = 0;
  let cmd = '';
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  // The last control point, for S and T.
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  const isCmd = (t: string | undefined) => t !== undefined && /^[A-Za-z]$/.test(t);
  const next = (): string => {
    const t = tokens[i];
    i += 1;
    if (t === undefined || isCmd(t)) throw new Error(`path "${d}" ends too soon`);
    return t;
  };
  const number = (): number => {
    const t = next();
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error(`path "${d}" has "${t}", which isn't a number`);
    return v;
  };
  const flag = (): boolean => {
    const t = next();
    if (t !== '0' && t !== '1') throw new Error(`path "${d}" has an arc flag "${t}" that isn't 0 or 1`);
    return t === '1';
  };
  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i] ?? '';
      i += 1;
    } else if (cmd === '') throw new Error(`path "${d}" has no command`);
    const rel = cmd === cmd.toLowerCase();
    const base = rel ? cur : { x: 0, y: 0 };
    const pt = (): Pt => {
      const x = number();
      const y = number();
      return { x: base.x + x, y: base.y + y };
    };
    const up = cmd.toUpperCase();
    if (up === 'Z') {
      out.push({ k: 'Z' });
      cur = start;
      lastCubic = null;
      lastQuad = null;
      // Z takes no numbers: the next token is a command.
      if (i < tokens.length && !isCmd(tokens[i])) throw new Error(`path "${d}" has numbers after Z`);
      continue;
    }
    if (up === 'M') {
      cur = pt();
      start = cur;
      out.push({ k: 'M', p: cur });
      // Numbers after a moveto are linetos.
      cmd = rel ? 'l' : 'L';
      lastCubic = null;
      lastQuad = null;
    } else if (up === 'L') {
      cur = pt();
      out.push({ k: 'L', p: cur });
      lastCubic = null;
      lastQuad = null;
    } else if (up === 'H' || up === 'V') {
      const v = number();
      cur = up === 'H' ? { x: (rel ? cur.x : 0) + v, y: cur.y } : { x: cur.x, y: (rel ? cur.y : 0) + v };
      out.push({ k: 'L', p: cur });
      lastCubic = null;
      lastQuad = null;
    } else if (up === 'C' || up === 'S') {
      const c1: Pt = up === 'C' ? pt() : lastCubic ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y } : cur;
      const c2 = pt();
      const p = pt();
      out.push({ k: 'C', c1, c2, p });
      lastCubic = c2;
      lastQuad = null;
      cur = p;
    } else if (up === 'Q' || up === 'T') {
      const c: Pt = up === 'Q' ? pt() : lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : cur;
      const p = pt();
      out.push({ k: 'Q', c, p });
      lastQuad = c;
      lastCubic = null;
      cur = p;
    } else if (up === 'A') {
      const rx = Math.abs(number());
      const ry = Math.abs(number());
      const turn = number();
      const large = flag();
      const sweep = flag();
      const p = pt();
      if (Math.hypot(p.x - cur.x, p.y - cur.y) < 1e-9) throw new Error(`path "${d}" has a zero-length arc`);
      out.push(rx === 0 || ry === 0 ? { k: 'L', p } : { k: 'A', rx, ry, turn, large, sweep, p });
      cur = p;
      lastCubic = null;
      lastQuad = null;
    } else throw new Error(`path command ${cmd} can't be read`);
  }
  if (out[0] !== undefined && out[0].k !== 'M') throw new Error(`path "${d}" doesn't start with a move`);
  return out;
}

const fmt = (v: number): string => {
  const r = Math.round(v * 10000) / 10000;
  return String(Object.is(r, -0) ? 0 : r);
};
const xy = (p: Pt) => `${fmt(p.x)} ${fmt(p.y)}`;

/** Segments moved by a transform, as path data: an arc's ends move and its axes turn with it. */
function pathData(segments: readonly Segment[], m: Matrix): string {
  const turn = turnOf(m);
  return segments
    .map((s) => {
      if (s.k === 'Z') return 'Z';
      if (s.k === 'M' || s.k === 'L') return `${s.k}${xy(apply(m, s.p))}`;
      if (s.k === 'C') return `C${xy(apply(m, s.c1))} ${xy(apply(m, s.c2))} ${xy(apply(m, s.p))}`;
      if (s.k === 'Q') return `Q${xy(apply(m, s.c))} ${xy(apply(m, s.p))}`;
      return `A${fmt(s.rx)} ${fmt(s.ry)} ${fmt((((s.turn + turn) % 360) + 360) % 360)} ${s.large ? '1' : '0'} ${s.sweep ? '1' : '0'} ${xy(apply(m, s.p))}`;
    })
    .join('');
}

/** Every point a path's outline passes through (sampled along its curves), every command absolute or relative. */
export function pathPoints(d: string): Pt[] {
  const out: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  for (const s of pathSegments(d)) {
    if (s.k === 'Z') {
      cur = start;
      out.push(cur);
      continue;
    }
    if (s.k === 'M') start = s.p;
    if (s.k === 'M' || s.k === 'L') out.push(s.p);
    else if (s.k === 'C') out.push(...bezierPoints([cur, s.c1, s.c2, s.p]));
    else if (s.k === 'Q') out.push(...bezierPoints([cur, s.c, s.p]));
    else out.push(...arcPoints(cur, s.rx, s.ry, s.turn, s.large, s.sweep, s.p));
    cur = s.p;
  }
  return out;
}

/** A shape's outline as path data on its own grid, before its transform. */
function outlineOf(name: string, a: Readonly<Record<string, string>>): string {
  switch (name) {
    case 'rect': {
      const x = numAttr(a, 'x', name, 0);
      const y = numAttr(a, 'y', name, 0);
      const w = numAttr(a, 'width', name);
      const h = numAttr(a, 'height', name);
      if (w <= 0 || h <= 0) throw new Error(`<rect> of ${String(w)} by ${String(h)} draws nothing`);
      // One radius given stands for both, and neither is past half a side, as SVG has it.
      const rxSet = a.rx === undefined ? undefined : numAttr(a, 'rx', name);
      const rySet = a.ry === undefined ? undefined : numAttr(a, 'ry', name);
      const rx = Math.min(w / 2, Math.max(0, rxSet ?? rySet ?? 0));
      const ry = Math.min(h / 2, Math.max(0, rySet ?? rxSet ?? 0));
      if (rx === 0 || ry === 0) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
      const r = `${fmt(rx)} ${fmt(ry)} 0 0 1`;
      return (
        `M${fmt(x + rx)} ${fmt(y)}H${fmt(x + w - rx)}A${r} ${fmt(x + w)} ${fmt(y + ry)}V${fmt(y + h - ry)}A${r} ${fmt(x + w - rx)} ${fmt(y + h)}` +
        `H${fmt(x + rx)}A${r} ${fmt(x)} ${fmt(y + h - ry)}V${fmt(y + ry)}A${r} ${fmt(x + rx)} ${fmt(y)}Z`
      );
    }
    case 'circle':
    case 'ellipse': {
      const cx = numAttr(a, 'cx', name, 0);
      const cy = numAttr(a, 'cy', name, 0);
      const rx = name === 'circle' ? numAttr(a, 'r', name) : numAttr(a, 'rx', name);
      const ry = name === 'circle' ? rx : numAttr(a, 'ry', name);
      if (rx <= 0 || ry <= 0) throw new Error(`<${name}> with a radius of ${String(Math.min(rx, ry))} draws nothing`);
      // From its right, clockwise, as SVG starts a circle (so a dash starts where the kit's does).
      const r = `${fmt(rx)} ${fmt(ry)} 0 0 1`;
      return `M${fmt(cx + rx)} ${fmt(cy)}A${r} ${fmt(cx - rx)} ${fmt(cy)}A${r} ${fmt(cx + rx)} ${fmt(cy)}Z`;
    }
    case 'line':
      return `M${fmt(numAttr(a, 'x1', name, 0))} ${fmt(numAttr(a, 'y1', name, 0))}L${fmt(numAttr(a, 'x2', name, 0))} ${fmt(numAttr(a, 'y2', name, 0))}`;
    case 'polyline':
    case 'polygon': {
      const raw = a.points;
      if (raw === undefined) throw new Error(`<${name}> has no points`);
      const v = raw
        .trim()
        .split(/[\s,]+/)
        .filter((s) => s !== '')
        .map((s) => num(s, `<${name}> points`));
      if (v.length < 4 || v.length % 2 !== 0) throw new Error(`<${name}> points "${raw}" aren't pairs`);
      const pairs: string[] = [];
      for (let k = 0; k < v.length; k += 2) pairs.push(`${k === 0 ? 'M' : 'L'}${fmt(v[k] ?? 0)} ${fmt(v[k + 1] ?? 0)}`);
      return pairs.join('') + (name === 'polygon' ? 'Z' : '');
    }
    case 'path': {
      const d = a.d;
      if (d === undefined || d.trim() === '') throw new Error('<path> has no d');
      return d;
    }
    default:
      throw new Error(`element <${name}> can't be read`);
  }
}

/** One element of an SVG's body: its name, attributes and the text inside it. */
interface Element {
  name: string;
  attrs: Record<string, string>;
  content: string;
}

/** An SVG's root attributes and the flat list of elements in it: nothing nested, nothing it doesn't know. */
function elementsOf(svg: string): { root: Record<string, string>; body: Element[] } {
  const s = svg.trim();
  const open = /^<svg\b([^>]*)>/.exec(s);
  if (!open) throw new Error('no <svg> root');
  if (!s.endsWith('</svg>')) throw new Error('no </svg> at its end');
  const root = attrsOf(open[1] ?? '', 'svg');
  const body = s.slice(open[0].length, s.length - '</svg>'.length);
  const out: Element[] = [];
  let at = 0;
  while (at < body.length) {
    const space = /^\s*/.exec(body.slice(at))?.[0].length ?? 0;
    at += space;
    if (at >= body.length) break;
    const rest = body.slice(at);
    const tag = /^<([A-Za-z][\w:-]*)\b((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(rest);
    if (!tag) throw new Error(`"${rest.slice(0, 24)}" can't be read`);
    const name = tag[1] ?? '';
    if (!ELEMENTS.has(name)) throw new Error(`element <${name}> can't be read`);
    const attrs = attrsOf(tag[2] ?? '', name);
    at += tag[0].length;
    let content = '';
    if (tag[3] !== '/') {
      const close = body.indexOf(`</${name}>`, at);
      if (close < 0) throw new Error(`<${name}> is never closed`);
      content = body.slice(at, close);
      if (content.includes('<')) throw new Error(`<${name}> holds other elements`);
      at = close + `</${name}>`.length;
    }
    out.push({ name, attrs, content });
  }
  return { root, body: out };
}

/** The paint and type a shape draws with: the root's, then its own attributes, then its style. */
function presentationOf(root: Readonly<Record<string, string>>, el: Element): Record<string, string> {
  const own: Record<string, string> = {};
  for (const [name, value] of Object.entries(el.attrs)) if (PRESENTATION.has(name)) own[name] = value;
  return { ...root, ...own, ...(el.attrs.style === undefined ? {} : styleOf(el.attrs.style, el.name)) };
}

const CAPS: readonly LineCap[] = ['butt', 'round', 'square'];
const JOINS: readonly LineJoin[] = ['miter', 'round', 'bevel'];

function dashOf(value: string | undefined, tag: string): number[] | null {
  if (value === undefined || value.trim() === 'none') return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s !== '')
    .map((s) => num(s, `<${tag}> stroke-dasharray`));
  if (parts.some((v) => v < 0)) throw new Error(`<${tag}> stroke-dasharray "${value}" is negative`);
  return parts.every((v) => v === 0) ? null : parts;
}

/** The weight a font-weight names. */
function weightOf(value: string | undefined, tag: string): number {
  if (value === undefined || value === 'normal') return 400;
  if (value === 'bold') return 700;
  return num(value, `<${tag}> font-weight`);
}

/** Outward to a hundredth, so the box always holds what it measured. */
const down = (v: number) => Math.floor(v * 100 + 1e-6) / 100;
const up = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;

/** What one icon's SVG draws: its shapes as data and the box of their geometry on the 32 px grid, kept inside the grid. */
export function iconDrawing(svg: string): IconDrawing {
  const { root, body } = elementsOf(svg);
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(root)) {
    if (PRESENTATION.has(name)) inherited[name] = value;
    else if (!ROOT_ONLY.has(name)) throw new Error(`<svg> attribute ${name} can't be read`);
  }
  if (root.viewBox !== undefined) {
    const view = root.viewBox
      .trim()
      .split(/[\s,]+/)
      .map((v) => num(v, '<svg> viewBox'));
    if (view.join(' ') !== `0 0 ${String(GRID)} ${String(GRID)}`) throw new Error(`<svg> viewBox "${root.viewBox}" isn't the 32 px grid`);
  }
  for (const name of ['width', 'height']) if (root[name] !== undefined) num(root[name] ?? '', `<svg> ${name}`);
  const shapes: IconPart[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (p: Pt) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const el of body) {
    if (el.name === 'title' || el.name === 'desc') {
      if (Object.keys(el.attrs).length > 0) throw new Error(`<${el.name}> has attributes`);
      continue;
    }
    const allowed = new Set([...(GEOMETRY[el.name] ?? []), ...PRESENTATION, 'transform', 'style', 'opacity']);
    for (const name of Object.keys(el.attrs)) if (!allowed.has(name)) throw new Error(`<${el.name}> attribute ${name} can't be read`);
    const p = presentationOf(inherited, el);
    // SVG's defaults: black fill, no stroke, 1 wide, butt caps, mitred joins.
    const fill = paint(p.fill ?? '#000000', `<${el.name}> fill`);
    const fillOpacity = p['fill-opacity'] === undefined ? 1 : opacity(p['fill-opacity'], `<${el.name}> fill-opacity`);
    const stroke = paint(p.stroke ?? 'none', `<${el.name}> stroke`);
    const own = el.attrs.opacity === undefined ? 1 : opacity(el.attrs.opacity, `<${el.name}> opacity`);
    if (el.name === 'text') {
      if (el.attrs.transform !== undefined) throw new Error('<text> with a transform can’t be drawn');
      if (stroke !== null) throw new Error('<text> with a stroke can’t be drawn');
      if (fill === null) throw new Error('<text> with no fill draws nothing');
      const text = el.content.trim();
      if (text === '' || /[&<>]/.test(text)) throw new Error(`<text> "${el.content}" can't be read`);
      const family = (p['font-family'] ?? '').split(',')[0]?.trim().replace(/^"(.*)"$/, '$1') ?? '';
      if (!FACES.includes(family)) throw new Error(`<text> font "${p['font-family'] ?? ''}" isn't a bundled face`);
      const anchor = p['text-anchor'] ?? 'start';
      if (anchor !== 'start' && anchor !== 'middle' && anchor !== 'end') throw new Error(`<text> text-anchor "${anchor}" can't be read`);
      const size = num(p['font-size'] ?? '', '<text> font-size');
      const x = numAttr(el.attrs, 'x', 'text', 0);
      const y = numAttr(el.attrs, 'y', 'text', 0);
      shapes.push({ kind: 'text', text, x, y, size, anchor, family, weight: weightOf(p['font-weight'], 'text'), fill, fillOpacity, opacity: own });
      // A nominal box: a monospace face's advance (0.6 em a character), from its cap height to its descent.
      const width = 0.6 * size * text.length;
      const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
      take({ x: left, y: y - 0.8 * size });
      take({ x: left + width, y: y + 0.2 * size });
      continue;
    }
    const lineCap = p['stroke-linecap'] ?? 'butt';
    const lineJoin = p['stroke-linejoin'] ?? 'miter';
    if (!(CAPS as readonly string[]).includes(lineCap)) throw new Error(`<${el.name}> stroke-linecap "${lineCap}" can't be read`);
    if (!(JOINS as readonly string[]).includes(lineJoin)) throw new Error(`<${el.name}> stroke-linejoin "${lineJoin}" can't be read`);
    const d = pathData(pathSegments(outlineOf(el.name, el.attrs)), transformOf(el.attrs.transform, el.name));
    shapes.push({
      kind: 'path',
      d,
      // A line is never filled.
      fill: el.name === 'line' ? null : fill,
      fillOpacity,
      stroke,
      strokeOpacity: p['stroke-opacity'] === undefined ? 1 : opacity(p['stroke-opacity'], `<${el.name}> stroke-opacity`),
      strokeWidth: p['stroke-width'] === undefined ? 1 : num(p['stroke-width'], `<${el.name}> stroke-width`),
      dash: dashOf(p['stroke-dasharray'], el.name),
      lineCap: lineCap as LineCap,
      lineJoin: lineJoin as LineJoin,
      opacity: own,
    });
    for (const pt of pathPoints(d)) take(pt);
  }
  if (shapes.length === 0) throw new Error('nothing drawn');
  const x = Math.max(0, down(minX));
  const y = Math.max(0, down(minY));
  const right = Math.min(GRID, up(maxX));
  const bottom = Math.min(GRID, up(maxY));
  const box = { x, y, width: Math.round((right - x) * 100) / 100, height: Math.round((bottom - y) * 100) / 100 };
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) throw new Error('its box isn’t a number');
  if (box.width < 0 || box.height < 0 || (box.width === 0 && box.height === 0)) throw new Error('its box is empty');
  return { box, shapes };
}

/** What one icon's SVG draws on the 32 px grid: the box of its geometry. */
export const iconBox = (svg: string): IconBox => iconDrawing(svg).box;

/** Every icon's drawing, by id ("set-art/sofa"), from its SVG's text; one that can't be read throws, naming its file. */
export function iconDrawings(svgs: Readonly<Record<string, string>>): Record<string, IconDrawing> {
  const out: Record<string, IconDrawing> = {};
  for (const id of Object.keys(svgs).sort()) {
    try {
      out[id] = iconDrawing(svgs[id] ?? '');
    } catch (error) {
      throw new Error(`${ICONS}/${id}.svg: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/** Every icon's box, by id. */
export function iconBoxes(svgs: Readonly<Record<string, string>>): Record<string, IconBox> {
  return Object.fromEntries(Object.entries(iconDrawings(svgs)).map(([id, drawing]) => [id, drawing.box]));
}

/** A value as TypeScript source, single-quoted as the repo writes it. */
function literal(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (typeof value === 'object') return `{ ${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${literal(v)}`).join(', ')} }`;
  throw new Error(`can't write ${typeof value}`);
}

/** The table as the TypeScript file the app reads. */
export function iconBoxesSource(drawings: Readonly<Record<string, IconDrawing>>): string {
  const boxes = Object.entries(drawings).map(([id, d]) => `  '${id}': ${literal(d.box)},`);
  const shapes = Object.entries(drawings).flatMap(([id, d]) => [`  '${id}': [`, ...d.shapes.map((s) => `    ${literal(s)},`), '  ],']);
  return [
    '// Written by scripts/planIconBoxes.ts (node scripts/planIconBoxes.ts, after the kit’s icons change); never edited by',
    '// hand. What each plan icon draws on its 32 px grid: the bare box of its geometry (no stroke padding), and its shapes',
    '// as data, paths with their transforms applied and texts, in the kit’s own colours. Shared by every item of an icon.',
    '',
    'export interface IconBox {',
    '  x: number;',
    '  y: number;',
    '  width: number;',
    '  height: number;',
    '}',
    '',
    'export interface IconPath {',
    "  kind: 'path';",
    '  d: string;',
    '  fill: string | null;',
    '  fillOpacity: number;',
    '  stroke: string | null;',
    '  strokeOpacity: number;',
    '  strokeWidth: number;',
    '  dash: readonly number[] | null;',
    "  lineCap: 'butt' | 'round' | 'square';",
    "  lineJoin: 'miter' | 'round' | 'bevel';",
    '  opacity: number;',
    '}',
    '',
    'export interface IconText {',
    "  kind: 'text';",
    '  text: string;',
    '  x: number;',
    '  y: number;',
    '  size: number;',
    "  anchor: 'start' | 'middle' | 'end';",
    '  family: string;',
    '  weight: number;',
    '  fill: string;',
    '  fillOpacity: number;',
    '  opacity: number;',
    '}',
    '',
    'export type IconPart = IconPath | IconText;',
    '',
    'export const ICON_BOXES: Readonly<Record<string, IconBox>> = {',
    ...boxes,
    '};',
    '',
    'export const ICON_SHAPES: Readonly<Record<string, readonly IconPart[]>> = {',
    ...shapes,
    '};',
    '',
  ].join('\n');
}

const ICONS = 'src/ui/icons/plan';
const OUT = 'src/features/birdseye/plan/iconBoxes.ts';

/** The kit's SVGs, by id, read from the repo. */
export function kitSvgs(root = '.'): Record<string, string> {
  const out: Record<string, string> = {};
  const folder = join(root, ICONS);
  for (const group of readdirSync(folder, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const file of readdirSync(join(folder, group.name))) {
      if (file.endsWith('.svg')) out[`${group.name}/${file.slice(0, -4)}`] = readFileSync(join(folder, group.name, file), 'utf8');
    }
  }
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const drawings = iconDrawings(kitSvgs());
  writeFileSync(OUT, iconBoxesSource(drawings));
  console.log(`Wrote ${String(Object.keys(drawings).length)} icons to ${OUT}.`);
}
