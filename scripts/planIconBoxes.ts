// The box each plan icon draws on its 32 px grid (6.3 review), written to src/features/birdseye/plan/iconBoxes.ts so
// an icon is cut to the same box in every engine, with or without a page: measuring in the page (getBBox on a hidden
// copy) gave a box that depended on the engine and on whether a font had loaded. Run it by hand after the kit's icons
// change, from the repo's root:
//
//   node scripts/planIconBoxes.ts
//
// It reads the kit's simple shapes (rect, circle, ellipse, line, polyline, polygon, path with every command, text as a
// nominal box at its x and y) and a shape's rotate or translate transform; each box is padded by half the widest stroke
// in its SVG, so a cut never clips a line's edge. An icon this can't read is entered by hand in BY_HAND below, with why.
// A Vitest test (src/features/birdseye/plan/iconBoxes.test.ts) runs `iconBoxes` again and checks the table is current.
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

interface Pt {
  x: number;
  y: number;
}

const GRID = 32;

/** Icons whose box is entered by hand, by id, each with why: none so far, as every kit icon reads. */
const BY_HAND: Readonly<Record<string, IconBox>> = {};

const attrsOf = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) if (m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  return out;
};
const n = (value: string | undefined, fallback = 0): number => {
  const v = value === undefined ? NaN : Number(value);
  return Number.isFinite(v) ? v : fallback;
};

/** A shape's transform as a function on points: rotate(a [cx cy]) and translate(x [y]); anything else can't be read. */
function transformOf(value: string | undefined): (p: Pt) => Pt {
  if (value === undefined || value.trim() === '') return (p) => p;
  const steps = [...value.matchAll(/(\w+)\(([^)]*)\)/g)].map((m) => ({ name: m[1] ?? '', args: (m[2] ?? '').split(/[\s,]+/).filter((s) => s !== '').map(Number) }));
  const fns = steps.map(({ name, args }): ((p: Pt) => Pt) => {
    if (name === 'translate') return (p) => ({ x: p.x + (args[0] ?? 0), y: p.y + (args[1] ?? 0) });
    if (name === 'rotate') {
      const a = ((args[0] ?? 0) * Math.PI) / 180;
      const cx = args[1] ?? 0;
      const cy = args[2] ?? 0;
      return (p) => ({ x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a), y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a) });
    }
    throw new Error(`transform ${name} can't be read`);
  });
  // The rightmost step applies first, as SVG has it.
  return (p) => fns.reduceRight((q, fn) => fn(q), p);
}

const SAMPLES = 96;

/** Points along an ellipse's outline (enough for a box). */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Pt[] {
  return Array.from({ length: SAMPLES }, (_, i) => {
    const a = (i / SAMPLES) * 2 * Math.PI;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

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
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
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

/** Every point a path's outline passes through (sampled along its curves), every command absolute or relative. */
export function pathPoints(d: string): Pt[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Pt[] = [];
  let i = 0;
  let cmd = '';
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  // The last control point, for S and T.
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  const isCmd = (t: string | undefined) => t !== undefined && /^[A-Za-z]$/.test(t);
  const num = (): number => {
    const t = tokens[i];
    i += 1;
    if (t === undefined || isCmd(t)) throw new Error(`path "${d}" ends too soon`);
    return Number(t);
  };
  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i] ?? '';
      i += 1;
    } else if (cmd === '') throw new Error(`path "${d}" has no command`);
    const rel = cmd === cmd.toLowerCase();
    const base = rel ? cur : { x: 0, y: 0 };
    const pt = (): Pt => {
      const x = num();
      const y = num();
      return { x: base.x + x, y: base.y + y };
    };
    const up = cmd.toUpperCase();
    if (up === 'Z') {
      cur = start;
      out.push(cur);
      lastCubic = null;
      lastQuad = null;
      // Z takes no numbers: the next token is a command.
      if (i < tokens.length && !isCmd(tokens[i])) throw new Error(`path "${d}" has numbers after Z`);
      continue;
    }
    if (up === 'M') {
      cur = pt();
      start = cur;
      out.push(cur);
      // Numbers after a moveto are linetos.
      cmd = rel ? 'l' : 'L';
      lastCubic = null;
      lastQuad = null;
    } else if (up === 'L' || up === 'T') {
      const to = pt();
      if (up === 'T') {
        const c: Pt = lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : cur;
        out.push(...bezierPoints([cur, c, to]));
        lastQuad = c;
      } else {
        out.push(to);
        lastQuad = null;
      }
      cur = to;
      lastCubic = null;
    } else if (up === 'H') {
      cur = { x: (rel ? cur.x : 0) + num(), y: cur.y };
      out.push(cur);
      lastCubic = null;
      lastQuad = null;
    } else if (up === 'V') {
      cur = { x: cur.x, y: (rel ? cur.y : 0) + num() };
      out.push(cur);
      lastCubic = null;
      lastQuad = null;
    } else if (up === 'C' || up === 'S') {
      const c1: Pt = up === 'C' ? pt() : lastCubic ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y } : cur;
      const c2 = pt();
      const to = pt();
      out.push(...bezierPoints([cur, c1, c2, to]));
      lastCubic = c2;
      lastQuad = null;
      cur = to;
    } else if (up === 'Q') {
      const c = pt();
      const to = pt();
      out.push(...bezierPoints([cur, c, to]));
      lastQuad = c;
      lastCubic = null;
      cur = to;
    } else if (up === 'A') {
      const rx = num();
      const ry = num();
      const rotation = num();
      const large = num() !== 0;
      const sweep = num() !== 0;
      const to = pt();
      out.push(...arcPoints(cur, rx, ry, rotation, large, sweep, to));
      cur = to;
      lastCubic = null;
      lastQuad = null;
    } else throw new Error(`path command ${cmd} can't be read`);
  }
  return out;
}

/** The points of one shape, before its transform; null for an element that draws nothing (title). */
function shapePoints(name: string, a: Record<string, string>, content: string): Pt[] | null {
  switch (name) {
    case 'rect': {
      const x = n(a.x);
      const y = n(a.y);
      const w = n(a.width);
      const h = n(a.height);
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    }
    case 'circle':
      return ellipsePoints(n(a.cx), n(a.cy), n(a.r), n(a.r));
    case 'ellipse':
      return ellipsePoints(n(a.cx), n(a.cy), n(a.rx), n(a.ry));
    case 'line':
      return [{ x: n(a.x1), y: n(a.y1) }, { x: n(a.x2), y: n(a.y2) }];
    case 'polyline':
    case 'polygon': {
      const v = (a.points ?? '').split(/[\s,]+/).filter((s) => s !== '').map(Number);
      const pts: Pt[] = [];
      for (let k = 0; k + 1 < v.length; k += 2) pts.push({ x: v[k] ?? 0, y: v[k + 1] ?? 0 });
      return pts;
    }
    case 'path':
      return pathPoints(a.d ?? '');
    case 'text': {
      // A nominal box: a monospace face's advance (0.6 em a character), from its cap height to its descent.
      const size = n(a['font-size'], 16);
      const width = 0.6 * size * content.trim().length;
      const x = n(a.x);
      const y = n(a.y);
      const anchor = a['text-anchor'] ?? 'start';
      const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
      return [{ x: left, y: y - 0.8 * size }, { x: left + width, y: y + 0.2 * size }];
    }
    case 'title':
    case 'desc':
      return null;
    default:
      throw new Error(`element <${name}> can't be read`);
  }
}

/** Outward to a hundredth, so the box always holds what it measured. */
const down = (v: number) => Math.floor(v * 100 + 1e-6) / 100;
const up = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;

/** What one icon's SVG draws on the 32 px grid, padded by half its widest stroke and kept inside the grid. */
export function iconBox(svg: string): IconBox {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const body = svg.slice(svg.indexOf(root) + root.length).replace(/<\/svg>\s*$/, '');
  const widths = [...svg.matchAll(/stroke-width="([^"]*)"/g)].map((m) => n(m[1]));
  // An SVG's strokes default to 1 when it sets none.
  const pad = Math.max(1, ...widths) / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of body.matchAll(/<(\w+)\b([^>]*?)(\/>|>([^<]*)<\/\1>)/g)) {
    const name = m[1] ?? '';
    const a = attrsOf(m[2] ?? '');
    const pts = shapePoints(name, a, m[4] ?? '');
    if (pts === null) continue;
    const move = transformOf(a.transform);
    for (const p of pts.map(move)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) throw new Error('nothing drawn');
  const x = Math.max(0, down(minX - pad));
  const y = Math.max(0, down(minY - pad));
  const right = Math.min(GRID, up(maxX + pad));
  const bottom = Math.min(GRID, up(maxY + pad));
  return { x, y, width: Math.round((right - x) * 100) / 100, height: Math.round((bottom - y) * 100) / 100 };
}

/** Every icon's box, by id ("set-art/sofa"), from its SVG's text: by hand where BY_HAND has it. */
export function iconBoxes(svgs: Readonly<Record<string, string>>): Record<string, IconBox> {
  const out: Record<string, IconBox> = {};
  for (const id of Object.keys(svgs).sort()) {
    const svg = svgs[id] ?? '';
    const hand = Object.hasOwn(BY_HAND, id) ? BY_HAND[id] : undefined;
    out[id] = hand ?? iconBox(svg);
  }
  return out;
}

/** The table as the TypeScript file the app reads. */
export function iconBoxesSource(boxes: Readonly<Record<string, IconBox>>): string {
  const rows = Object.entries(boxes).map(([id, b]) => `  '${id}': { x: ${String(b.x)}, y: ${String(b.y)}, width: ${String(b.width)}, height: ${String(b.height)} },`);
  return [
    '// Written by scripts/planIconBoxes.ts (node scripts/planIconBoxes.ts, after the kit’s icons change); never edited by',
    '// hand. What each plan icon draws on its 32 px grid, padded by half its widest stroke: the box an icon is cut to.',
    '',
    'export interface IconBox {',
    '  x: number;',
    '  y: number;',
    '  width: number;',
    '  height: number;',
    '}',
    '',
    'export const ICON_BOXES: Readonly<Record<string, IconBox>> = {',
    ...rows,
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
  const boxes = iconBoxes(kitSvgs());
  writeFileSync(OUT, iconBoxesSource(boxes));
  console.log(`Wrote ${String(Object.keys(boxes).length)} boxes to ${OUT}.`);
}
