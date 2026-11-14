// What a deck page draws, as plain data (5.6a): the canvas's own drawing of one page, read back from Konva's nodes into a short
// list of operations (save, transform, clip, path, text, picture, link), so the PDF is made from exactly what Present shows,
// live cards included, and not from a second drawing of every kind of card that could drift from the first. Konva itself stays in
// deckRender.tsx; this file knows only the plain `PrintNode` snapshot it makes, so the walk and the PDF writer run in the unit
// tests with no canvas.

/** A 2D matrix as Konva and PDF both have it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `first`, then `second`: the matrix of a point taken through `first`'s transform and on through `second`'s. */
export function followed(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * One node of the canvas's drawing, as plain data. `attrs` are the attributes the node was given (defaults are applied here).
 * A `wedge` is a circle's slice (6.10: a light's beam); a `glyph` is one line of text drawn at its baseline by a shape of the
 * plan's own (6.10: an icon's text, `attrs.sbText`).
 */
export interface PrintNode {
  kind: 'group' | 'rect' | 'ellipse' | 'line' | 'path' | 'text' | 'image' | 'wedge' | 'glyph';
  /** The node's own transform (its position, rotation, scale and offset), relative to its parent. */
  matrix: Matrix;
  opacity: number;
  visible: boolean;
  attrs: Readonly<Record<string, unknown>>;
  children: readonly PrintNode[];
  /** A text node's layout as the canvas worked it out: the lines it broke the words into, and its box. */
  layout?: { lines: readonly { text: string }[]; width: number; height: number; baselineShift: number };
}

export type Segment = { m: readonly [number, number] } | { l: readonly [number, number] } | { c: readonly [number, number, number, number, number, number] } | { z: true };

export type DisplayOp =
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'concat'; m: Matrix }
  | { op: 'clip'; x: number; y: number; width: number; height: number }
  | { op: 'opacity'; value: number }
  | {
      op: 'shape';
      path: readonly Segment[];
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
      /** The width is in page units whatever the shape's own scale (the canvas's strokeScaleEnabled false). */
      fixedStroke: boolean;
      dash: readonly number[];
      cap: 'butt' | 'round' | 'square';
      join: 'miter' | 'round' | 'bevel';
    }
  | {
      op: 'text';
      /** The lines, each with the baseline the canvas gave it, in the node's own coordinates. */
      lines: readonly { text: string; baseline: number }[];
      align: 'left' | 'center' | 'right';
      padding: number;
      /** The width the lines are aligned within. */
      width: number;
      family: string;
      weight: number;
      italic: boolean;
      size: number;
      fill: string;
      letterSpacing: number;
      /**
       * A stroke under the letters (6.10: a plan label's paper halo), drawn first and covered by the fill, its width in the
       * node's units. Absent for text with no stroke, so a deck's text is as it was.
       */
      stroke?: { colour: string; width: number };
    }
  | { op: 'image'; sha256: string; width: number; height: number }
  | { op: 'link'; url: string; width: number; height: number };

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

/** `#RRGGBB` (or `#RGB`), or `rgb()` and `rgba()`, as 0 to 1 channels; null for anything else (a name, a transparent fill). */
export function parseColour(value: unknown): [number, number, number] | null {
  return parsePaint(value)?.rgb ?? null;
}

/**
 * A paint as its colour and its alpha (6.10): `#RRGGBB`, `#RGB`, `rgb(r, g, b)` or `rgba(r, g, b, a)`, as the plan's kit
 * paints are (paintOf). Null for anything else, and for a paint that is wholly transparent (it draws nothing) unless
 * `keepClear` asks for it (a gradient's clear end still has a colour).
 */
export function parsePaint(value: unknown, keepClear = false): { rgb: [number, number, number]; alpha: number } | null {
  if (typeof value !== 'string') return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1] ?? /^#([0-9a-f]{3})$/i.exec(value)?.[1]?.replace(/./g, '$&$&');
  if (hex) {
    const n = parseInt(hex, 16);
    return { rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], alpha: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!fn) return null;
  const channel = (text: string | undefined) => Math.min(255, Math.max(0, Number(text))) / 255;
  const alpha = fn[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(fn[4])));
  if (!Number.isFinite(alpha) || (alpha <= 0 && !keepClear)) return null;
  return { rgb: [channel(fn[1]), channel(fn[2]), channel(fn[3])], alpha };
}

/** A colour and an alpha as the canvas writes a paint: the hex alone when opaque. */
export function paintText(rgb: readonly [number, number, number], alpha: number): string {
  const [r, g, b] = rgb.map((c) => Math.round(c * 255));
  if (alpha >= 1) return `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(Math.round(alpha * 1000) / 1000)})`;
}

/** The first family of a CSS list: `"Archivo", "Inter Tight"` is Archivo, which is the one a person asked for. */
export function firstFamily(list: string): string {
  const quoted = /^\s*"((?:[^"\\]|\\.)*)"/.exec(list);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/\\(.)/g, '$1');
  return (list.split(',')[0] ?? '').trim().replace(/^'|'$/g, '');
}

/** The weight and slant of a Konva font style ("italic 700", "bold", "normal"). */
export function parseFontStyle(style: string): { weight: number; italic: boolean } {
  let weight = 400;
  let italic = false;
  for (const word of style.toLowerCase().split(/\s+/)) {
    if (word === 'italic' || word === 'oblique') italic = true;
    else if (word === 'bold') weight = 700;
    else if (/^[1-9]00$/.test(word)) weight = Number(word);
  }
  return { weight, italic };
}

const KAPPA = 0.5522847498307936;

function ellipse(rx: number, ry: number): Segment[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    { m: [rx, 0] },
    { c: [rx, ky, kx, ry, 0, ry] },
    { c: [-kx, ry, -rx, ky, -rx, 0] },
    { c: [-rx, -ky, -kx, -ry, 0, -ry] },
    { c: [kx, -ry, rx, -ky, rx, 0] },
    { z: true },
  ];
}

type Cubic = [number, number, number, number, number, number];

/**
 * An elliptical arc as SVG's A writes it, from (x1, y1) to (x2, y2), as cubics of at most a quarter turn each (6.10: the
 * plan kit's circles and rounded corners, a door's swing). The endpoint form is turned into a centre, radii and angles
 * (SVG 1.1, appendix F.6), radii too small for the ends grown until they reach. Each quarter's cubic stays within about
 * 0.03% of the radius of the true ellipse. A zero radius is a straight line, as SVG says.
 */
export function arcCubics(x1: number, y1: number, rxIn: number, ryIn: number, degrees: number, large: boolean, sweep: boolean, x2: number, y2: number): Cubic[] | 'line' {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return 'line';
  const phi = (degrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const grow = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let turn = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && turn > 0) turn -= 2 * Math.PI;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  return ellipseCubics(cx, cy, rx, ry, phi, start, turn);
}

/** Part of an ellipse (centre, radii, its turn `phi`) from angle `start` through `turn` (radians, either way), as cubics of a quarter turn at most. */
export function ellipseCubics(cx: number, cy: number, rx: number, ry: number, phi: number, start: number, turn: number): Cubic[] {
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const at = (ux: number, uy: number): [number, number] => [cx + rx * ux * cos - ry * uy * sin, cy + rx * ux * sin + ry * uy * cos];
  const count = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 2) - 1e-9));
  const step = turn / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Cubic[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = start + i * step;
    const b = a + step;
    const c1 = at(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a));
    const c2 = at(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b));
    const end = at(Math.cos(b), Math.sin(b));
    out.push([...c1, ...c2, ...end]);
  }
  return out;
}

/** How many numbers each SVG path command takes. */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

/**
 * The commands of an SVG path, absolute or relative: M, L, H, V, C, S, Q, T, A and Z. Quadratics and arcs become cubics
 * (6.10: the plan kit draws circles with two arcs, and a stop at the first A left half a drawing out of the PDF). Anything
 * else ends the path where it stands.
 */
export function parsePathData(data: string): Segment[] {
  const out: Segment[] = [];
  // Numbers as SVG writes them: a sign of either kind, an exponent in either case ("1E-3"); "e" and "E" are no command.
  const tokens = data.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[a-df-zA-DF-Z]/g) ?? [];
  let at = 0;
  let current: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  // The last cubic's or quadratic's second control point, for S and T, which mirror it.
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  const isNumber = (token: string | undefined) => token !== undefined && /^[+-]?[\d.]/.test(token);
  const read = (count: number): number[] | null => {
    const values = tokens.slice(at, at + count);
    if (values.length < count || !values.every(isNumber)) return null;
    at += count;
    return values.map(Number);
  };
  // An arc's flags are one digit each and may run into what follows ("a5 5 0 105 5" is 1, 0, 5): split off before reading.
  const splitFlags = () => {
    for (const k of [at + 3, at + 4]) {
      const token = tokens[k];
      if (token !== undefined && /^[01]./.test(token)) tokens.splice(k, 1, token.charAt(0), token.slice(1));
    }
  };
  const cubic = (c: Cubic) => {
    out.push({ c });
    current = [c[4], c[5]];
  };
  while (at < tokens.length) {
    const command = tokens[at++] ?? '';
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === 'Z') {
      out.push({ z: true });
      current = start;
      lastCubic = null;
      lastQuad = null;
      continue;
    }
    const arity = ARITY[upper];
    if (arity === undefined) break;
    // A command may repeat its numbers: more pairs after M are lines.
    let again = upper;
    do {
      if (again === 'A') splitFlags();
      const v = read(arity);
      if (!v) return out;
      const [ox, oy] = relative ? current : [0, 0];
      const n = (i: number) => v[i] ?? 0;
      const [cx, cy] = current;
      let nextCubic: [number, number] | null = null;
      let nextQuad: [number, number] | null = null;
      if (again === 'M' || again === 'L' || again === 'H' || again === 'V') {
        const point: [number, number] =
          again === 'H' ? [ox + n(0), cy] : again === 'V' ? [cx, oy + n(0)] : [ox + n(0), oy + n(1)];
        out.push(again === 'M' ? { m: point } : { l: point });
        current = point;
        if (again === 'M') start = point;
      } else if (again === 'C' || again === 'S') {
        const first: [number, number] = again === 'C' ? [ox + n(0), oy + n(1)] : lastCubic ? [2 * cx - lastCubic[0], 2 * cy - lastCubic[1]] : [cx, cy];
        const rest = again === 'C' ? 2 : 0;
        const second: [number, number] = [ox + n(rest), oy + n(rest + 1)];
        cubic([...first, ...second, ox + n(rest + 2), oy + n(rest + 3)]);
        nextCubic = second;
      } else if (again === 'Q' || again === 'T') {
        const q: [number, number] = again === 'Q' ? [ox + n(0), oy + n(1)] : lastQuad ? [2 * cx - lastQuad[0], 2 * cy - lastQuad[1]] : [cx, cy];
        const rest = again === 'Q' ? 2 : 0;
        const end: [number, number] = [ox + n(rest), oy + n(rest + 1)];
        // A quadratic is the cubic whose controls are two thirds of the way from each end to its one control point.
        cubic([cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1]), ...end]);
        nextQuad = q;
      } else {
        const end: [number, number] = [ox + n(5), oy + n(6)];
        const arcs = arcCubics(cx, cy, n(0), n(1), n(2), n(3) !== 0, n(4) !== 0, end[0], end[1]);
        if (arcs === 'line') {
          out.push({ l: end });
          current = end;
        } else for (const c of arcs) cubic(c);
        current = end;
      }
      lastCubic = nextCubic;
      lastQuad = nextQuad;
      again = again === 'M' ? 'L' : again;
    } while (at < tokens.length && isNumber(tokens[at]));
  }
  return out;
}

/**
 * The turn a Konva Wedge's arc makes, radians (positive is clockwise on the page, whose y runs down). Konva hands its
 * `clockwise` to the canvas's arc() as `anticlockwise` (Wedge.js: arc(0, 0, r, 0, angle, clockwise)), so a wedge with it
 * set goes the other way round, the long way: from 0 back through 360° less its angle, and at a full 360° (start and
 * end the same point, the canvas draws no arc) nothing. Without it, its angle clockwise, as the plan's beams are.
 */
export function wedgeTurn(degrees: number, clockwise: boolean): number {
  const angle = (Math.min(360, Math.max(0, degrees)) * Math.PI) / 180;
  if (!clockwise) return angle;
  return angle <= 0 || angle >= 2 * Math.PI ? 0 : -(2 * Math.PI - angle);
}

function shapeOp(node: PrintNode, path: Segment[]): DisplayOp {
  const a = node.attrs;
  const strokeColour = typeof a.stroke === 'string' && a.strokeEnabled !== false ? a.stroke : null;
  return {
    op: 'shape',
    path,
    fill: typeof a.fill === 'string' && a.fillEnabled !== false ? a.fill : null,
    stroke: strokeColour,
    // Konva's default stroke is two units wide.
    strokeWidth: num(a.strokeWidth, 2),
    fixedStroke: a.strokeScaleEnabled === false,
    dash: Array.isArray(a.dash) ? a.dash.filter((n): n is number => typeof n === 'number' && n > 0) : [],
    cap: a.lineCap === 'round' || a.lineCap === 'square' ? a.lineCap : 'butt',
    join: a.lineJoin === 'round' || a.lineJoin === 'bevel' ? a.lineJoin : 'miter',
  };
}

/** How many rings a radial gradient prints as. */
export const GRADIENT_RINGS = 8;

/** A ring between two radii (the inner one wound the other way, so it is a hole under the nonzero rule). */
function ring(outer: number, inner: number): Segment[] {
  const out = ellipse(outer, outer);
  if (inner <= 0) return out;
  const reversed = ellipseCubics(0, 0, inner, inner, 0, 0, -2 * Math.PI).map((c): Segment => ({ c }));
  return [...out, { m: [inner, 0] }, ...reversed, { z: true }];
}

/**
 * A circle's radial fill (6.10: an all-round light's glow, from its middle out to nothing) as rings of flat paint, each the
 * gradient's colour at its middle, so it prints with real transparency where a PDF path can't hold a canvas gradient.
 * Read from Konva's `fillRadialGradientColorStops` (offset, colour pairs) out to `fillRadialGradientEndRadius`; none
 * when the node has no such fill.
 */
function radialRings(a: Readonly<Record<string, unknown>>, radius: number): DisplayOp[] {
  const stops = Array.isArray(a.fillRadialGradientColorStops) ? (a.fillRadialGradientColorStops as unknown[]) : [];
  if (stops.length < 4 || a.fillEnabled === false) return [];
  const read: { at: number; rgb: [number, number, number]; alpha: number }[] = [];
  for (let i = 0; i + 1 < stops.length; i += 2) {
    const at = stops[i];
    const colour = stops[i + 1];
    const paint = parsePaint(colour, true);
    if (typeof at === 'number' && paint) read.push({ at, rgb: paint.rgb, alpha: paint.alpha });
  }
  if (read.length < 2) return [];
  const end = num(a.fillRadialGradientEndRadius, radius);
  const colourAt = (t: number) => {
    const after = read.findIndex((stop) => stop.at >= t);
    const hi = read[after === -1 ? read.length - 1 : after] ?? read[0];
    const lo = read[Math.max(0, (after === -1 ? read.length : after) - 1)] ?? hi;
    if (!hi || !lo) return { rgb: [0, 0, 0] as [number, number, number], alpha: 0 };
    const span = hi.at - lo.at;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - lo.at) / span)) : 0;
    const mix = (x: number, y: number) => x + (y - x) * f;
    // The colour from whichever end is seen (a stop at no alpha has no colour of its own to give).
    const rgb = lo.alpha === 0 ? hi.rgb : hi.alpha === 0 ? lo.rgb : (lo.rgb.map((c, k) => mix(c, hi.rgb[k] ?? c)) as [number, number, number]);
    return { rgb, alpha: mix(lo.alpha, hi.alpha) };
  };
  const ops: DisplayOp[] = [];
  for (let k = 0; k < GRADIENT_RINGS; k += 1) {
    const paint = colourAt((k + 0.5) / GRADIENT_RINGS);
    if (paint.alpha <= 0.001) continue;
    ops.push({
      op: 'shape',
      path: ring((end * (k + 1)) / GRADIENT_RINGS, (end * k) / GRADIENT_RINGS),
      fill: paintText(paint.rgb, paint.alpha),
      stroke: null,
      strokeWidth: 0,
      fixedStroke: false,
      dash: [],
      cap: 'butt',
      join: 'miter',
    });
  }
  return ops;
}

/** A text node's stroke (6.10: a plan label's paper halo), when it has one. */
function textStroke(a: Readonly<Record<string, unknown>>): { stroke?: { colour: string; width: number } } {
  const width = num(a.strokeWidth, 0);
  if (typeof a.stroke !== 'string' || a.strokeEnabled === false || width <= 0) return {};
  return { stroke: { colour: a.stroke, width } };
}

function ownOps(node: PrintNode): DisplayOp[] {
  const a = node.attrs;
  switch (node.kind) {
    case 'rect': {
      const w = num(a.width, 0);
      const h = num(a.height, 0);
      return [shapeOp(node, [{ m: [0, 0] }, { l: [w, 0] }, { l: [w, h] }, { l: [0, h] }, { z: true }])];
    }
    case 'ellipse': {
      // A circle (6.10: the plan's) has one radius.
      const rx = num(a.radiusX, num(a.radius, 0));
      const ry = num(a.radiusY, num(a.radius, 0));
      const rings = typeof a.fill === 'string' ? [] : radialRings(a, Math.min(rx, ry));
      return [...rings, shapeOp(node, ellipse(rx, ry))];
    }
    case 'wedge': {
      // As Konva draws one: from its middle, an arc from 0° through its angle (its turn is the node's), back to the middle.
      const r = num(a.radius, 0);
      const arc = ellipseCubics(0, 0, r, r, 0, 0, wedgeTurn(num(a.angle, 0), a.clockwise === true)).map((c): Segment => ({ c }));
      return [shapeOp(node, [{ m: [r, 0] }, ...arc, { l: [0, 0] }, { z: true }])];
    }
    case 'glyph': {
      // An icon's text (6.10): one line in its face, at its SVG baseline, anchored as SVG's text-anchor says.
      const part = a.sbText as { text?: unknown; x?: unknown; y?: unknown; size?: unknown; anchor?: unknown; family?: unknown; weight?: unknown; fill?: unknown; fillOpacity?: unknown } | undefined;
      if (!part || typeof part.text !== 'string' || part.text === '') return [];
      const align = part.anchor === 'middle' ? 'center' : part.anchor === 'end' ? 'right' : 'left';
      const paint = parsePaint(part.fill);
      if (!paint) return [];
      return [
        { op: 'save' },
        { op: 'concat', m: [1, 0, 0, 1, num(part.x, 0), 0] },
        {
          op: 'text',
          lines: [{ text: part.text, baseline: num(part.y, 0) }],
          align,
          padding: 0,
          width: 0,
          family: str(part.family, 'JetBrains Mono'),
          weight: num(part.weight, 400),
          italic: false,
          size: num(part.size, 12),
          fill: paintText(paint.rgb, paint.alpha * Math.min(1, Math.max(0, num(part.fillOpacity, 1)))),
          letterSpacing: 0,
        },
        { op: 'restore' },
      ];
    }
    case 'line': {
      const points = Array.isArray(a.points) ? a.points.filter((n): n is number => typeof n === 'number') : [];
      if (points.length < 4) return [];
      const path: Segment[] = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        const at: [number, number] = [points[i] ?? 0, points[i + 1] ?? 0];
        path.push(i === 0 ? { m: at } : { l: at });
      }
      if (a.closed === true) path.push({ z: true });
      return [shapeOp(node, path)];
    }
    case 'path':
      return [shapeOp(node, parsePathData(str(a.data, '')))];
    case 'text': {
      const layout = node.layout;
      const fill = typeof a.fill === 'string' ? a.fill : '#000000';
      if (!layout || layout.lines.length === 0 || str(a.text, '') === '') return [];
      const size = num(a.fontSize, 12);
      const lineHeight = num(a.lineHeight, 1) * size;
      const padding = num(a.padding, 0);
      // As Konva places them: the block's top (by the vertical alignment), then each line's middle shifted down to its baseline.
      const free = layout.height - layout.lines.length * lineHeight - padding * 2;
      const vertical = a.verticalAlign === 'middle' ? padding + free / 2 : a.verticalAlign === 'bottom' ? padding + free : padding;
      const { weight, italic } = parseFontStyle(str(a.fontStyle, 'normal'));
      const align = a.align === 'center' || a.align === 'right' ? a.align : 'left';
      return [
        {
          op: 'text',
          lines: layout.lines.map((line, n) => ({ text: line.text, baseline: vertical + lineHeight / 2 + layout.baselineShift + n * lineHeight })),
          align,
          padding,
          width: layout.width,
          family: firstFamily(str(a.fontFamily, 'Arial')),
          weight,
          italic,
          size,
          fill,
          letterSpacing: num(a.letterSpacing, 0),
          ...textStroke(a),
        },
      ];
    }
    case 'image': {
      // A picture node that doesn't say which picture it is (an empty hash) stays an operation, so the export can count it as unprintable.
      return 'sbSha' in a ? [{ op: 'image', sha256: str(a.sbSha, ''), width: num(a.width, 0), height: num(a.height, 0) }] : [];
    }
    default:
      return [];
  }
}

/**
 * The operations that draw a node and what is under it: its transform and clip, its own shape, then its children in order. A node
 * that is hidden, or that is fully transparent, draws nothing. A link card's box also makes a `link` operation.
 */
export function displayOps(node: PrintNode): DisplayOp[] {
  const opacity = node.opacity;
  if (!node.visible || opacity <= 0) return [];
  const ops: DisplayOp[] = [{ op: 'save' }, { op: 'concat', m: node.matrix }];
  if (opacity < 1) ops.push({ op: 'opacity', value: opacity });
  const clipWidth = num(node.attrs.clipWidth, 0);
  const clipHeight = num(node.attrs.clipHeight, 0);
  // As Konva has it, a clip is on when it has both a width and a height.
  if (node.kind === 'group' && clipWidth && clipHeight) ops.push({ op: 'clip', x: num(node.attrs.clipX, 0), y: num(node.attrs.clipY, 0), width: clipWidth, height: clipHeight });
  ops.push(...ownOps(node));
  const url = str(node.attrs.sbUrl, '');
  if (node.kind === 'rect' && url !== '') ops.push({ op: 'link', url, width: num(node.attrs.width, 0), height: num(node.attrs.height, 0) });
  for (const child of node.children) ops.push(...displayOps(child));
  ops.push({ op: 'restore' });
  return ops;
}
