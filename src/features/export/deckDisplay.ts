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

/** One node of the canvas's drawing, as plain data. `attrs` are the attributes the node was given (defaults are applied here). */
export interface PrintNode {
  kind: 'group' | 'rect' | 'ellipse' | 'line' | 'path' | 'text' | 'image';
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
    }
  | { op: 'image'; sha256: string; width: number; height: number }
  | { op: 'link'; url: string; width: number; height: number };

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

/** `#RRGGBB` (or `#RGB`) as 0 to 1 channels; null for anything else (a name, a transparent fill). */
export function parseColour(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1] ?? /^#([0-9a-f]{3})$/i.exec(value)?.[1]?.replace(/./g, '$&$&');
  if (!hex) return null;
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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

/** The absolute commands of an SVG path (M, L, C, Z, with their lower-case forms for the ones the canvas writes); anything else ends it. */
export function parsePathData(data: string): Segment[] {
  const out: Segment[] = [];
  const tokens = data.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let at = 0;
  let current: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  const read = (count: number): number[] | null => {
    const values = tokens.slice(at, at + count).map(Number);
    if (values.length < count || values.some((v) => Number.isNaN(v))) return null;
    at += count;
    return values;
  };
  while (at < tokens.length) {
    const command = tokens[at++] ?? '';
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const origin = relative ? current : ([0, 0] as const);
    if (upper === 'Z') {
      out.push({ z: true });
      current = start;
      continue;
    }
    if (upper !== 'M' && upper !== 'L' && upper !== 'C') break;
    // A command may repeat its numbers: more pairs after M are lines.
    let again = upper;
    do {
      if (again === 'C') {
        const v = read(6);
        if (!v) return out;
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = v;
        out.push({ c: [origin[0] + x1, origin[1] + y1, origin[0] + x2, origin[1] + y2, origin[0] + x, origin[1] + y] });
        current = [origin[0] + x, origin[1] + y];
      } else {
        const v = read(2);
        if (!v) return out;
        const point: [number, number] = [origin[0] + (v[0] ?? 0), origin[1] + (v[1] ?? 0)];
        out.push(again === 'M' ? { m: point } : { l: point });
        current = point;
        if (again === 'M') start = point;
      }
      again = again === 'M' ? 'L' : again;
    } while (at < tokens.length && /^-?[\d.]/.test(tokens[at] ?? ''));
  }
  return out;
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

function ownOps(node: PrintNode): DisplayOp[] {
  const a = node.attrs;
  switch (node.kind) {
    case 'rect': {
      const w = num(a.width, 0);
      const h = num(a.height, 0);
      return [shapeOp(node, [{ m: [0, 0] }, { l: [w, 0] }, { l: [w, h] }, { l: [0, h] }, { z: true }])];
    }
    case 'ellipse':
      return [shapeOp(node, ellipse(num(a.radiusX, 0), num(a.radiusY, 0)))];
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
