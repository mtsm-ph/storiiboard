import { followed, IDENTITY, type DisplayOp, type Matrix, type Segment } from './deckDisplay';

// Display operations painted onto a 2D canvas (6.10): a plan's page as a PNG, from the very list its PDF is written from,
// so the picture and the PDF are one drawing. Transparency is the canvas's own (an rgba paint, an opacity); text is set
// in its face, which the page has loaded; a fixed-width line is as wide in the page's units whatever its transform, as
// the PDF writer has it.

type Ctx = CanvasRenderingContext2D;

const pathOf = (segments: readonly Segment[]): Path2D => {
  const path = new Path2D();
  for (const s of segments) {
    if ('m' in s) path.moveTo(s.m[0], s.m[1]);
    else if ('l' in s) path.lineTo(s.l[0], s.l[1]);
    else if ('c' in s) path.bezierCurveTo(...s.c);
    else path.closePath();
  }
  return path;
};

const cssFont = (op: Extract<DisplayOp, { op: 'text' }>) => `${op.italic ? 'italic ' : ''}${String(op.weight)} ${String(op.size)}px "${op.family}"`;

/**
 * Paints `ops` onto `ctx`, the page's units mapped by `base` (a page in points at 200 dpi: a scale of 200 / 72).
 * `picture` gives a picture's pixels by its hash; one it can't is left out, and counted.
 */
export function paintOps(ctx: Ctx, ops: readonly DisplayOp[], base: Matrix, picture: (sha256: string) => CanvasImageSource | null): { unprintable: number } {
  let unprintable = 0;
  const stack: Matrix[] = [IDENTITY];
  const now = () => stack[stack.length - 1] ?? IDENTITY;
  const place = () => {
    const [a, b, c, d, e, f] = followed(now(), base);
    ctx.setTransform(a, b, c, d, e, f);
  };
  ctx.save();
  // Runs are placed by unkerned advances (planPages' fontMeasure, as pdf-lib sets them): kerned here, they would touch.
  ctx.fontKerning = 'none';
  place();
  for (const op of ops) {
    switch (op.op) {
      case 'save':
        stack.push(now());
        ctx.save();
        break;
      case 'restore':
        if (stack.length > 1) {
          stack.pop();
          ctx.restore();
        }
        break;
      case 'concat':
        stack[stack.length - 1] = followed(op.m, now());
        place();
        break;
      case 'clip':
        ctx.beginPath();
        ctx.rect(op.x, op.y, op.width, op.height);
        ctx.clip();
        break;
      case 'opacity':
        ctx.globalAlpha *= op.value;
        break;
      case 'shape': {
        const path = pathOf(op.path);
        if (op.fill !== null) {
          ctx.fillStyle = op.fill;
          ctx.fill(path);
        }
        if (op.stroke !== null && op.strokeWidth > 0) {
          const m = now();
          const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
          const unit = op.fixedStroke && det > 0 ? 1 / Math.sqrt(det) : 1;
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.strokeWidth * unit;
          ctx.setLineDash(op.dash.map((d) => d * unit));
          ctx.lineCap = op.cap;
          ctx.lineJoin = op.join;
          ctx.stroke(path);
          ctx.setLineDash([]);
        }
        break;
      }
      case 'text': {
        ctx.font = cssFont(op);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        for (const line of op.lines) {
          if (line.text === '') continue;
          const letters = Array.from(line.text).length;
          const width = ctx.measureText(line.text).width + op.letterSpacing * Math.max(0, letters - 1);
          const x = op.align === 'right' ? op.width - op.padding - width : op.align === 'center' ? op.padding + (op.width - width - op.padding * 2) / 2 : op.padding;
          if (op.stroke) {
            ctx.strokeStyle = op.stroke.colour;
            ctx.lineWidth = op.stroke.width;
            ctx.lineJoin = 'round';
            ctx.strokeText(line.text, x, line.baseline);
          }
          ctx.fillStyle = op.fill;
          ctx.fillText(line.text, x, line.baseline);
        }
        break;
      }
      case 'image': {
        const source = op.sha256 === '' ? null : picture(op.sha256);
        if (source) ctx.drawImage(source, 0, 0, op.width, op.height);
        else unprintable += 1;
        break;
      }
      case 'link':
        break;
    }
  }
  while (stack.length > 1) {
    stack.pop();
    ctx.restore();
  }
  ctx.restore();
  return { unprintable };
}
