import { memo } from 'react';
import { arrowHead, pressureOutline, type Stroke } from './strokes';

// A frame's sketch on its card (1.13): inline SVG over the picture, in the text colour, so it reads on paper in light
// and dark alike. The editor draws the same strokes with Konva; this needs no canvas, so a 1000-frame board stays a
// page of plain elements.

/**
 * The SVG for one stroke, in a box `width` by `height`. `minLine` keeps a thin line visible when the box is drawn small
 * (a card is about 100px tall, where a pencil line would be under half a pixel).
 */
export function StrokeShape({ stroke, width, height, minLine = 0 }: { stroke: Stroke; width: number; height: number; minLine?: number }) {
  // The width as a share of the height, raised to the floor; pressure strokes and arrowheads scale from it too.
  const base = Math.max(stroke.width, minLine / height);
  const line = base * height;
  const p = stroke.points.map((n, i) => (i % 2 === 0 ? n * width : n * height));
  if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
    return (
      <rect
        x={Math.min(x1, x2)}
        y={Math.min(y1, y2)}
        width={Math.abs(x2 - x1)}
        height={Math.abs(y2 - y1)}
        fill="none"
        stroke="currentColor"
        strokeWidth={line}
      />
    );
  }
  if (stroke.tool === 'arrow') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={line} strokeLinecap="round" />
        <polygon points={arrowHead(stroke.points, width, height, base).join(' ')} fill="currentColor" />
      </g>
    );
  }
  if (stroke.pressures) {
    return <polygon points={pressureOutline(stroke.points, stroke.pressures, width, height, base).join(' ')} fill="currentColor" />;
  }
  return (
    <polyline
      points={p.join(' ')}
      fill="none"
      stroke="currentColor"
      strokeWidth={line}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * Fills its parent, which gives the frame its shape (width over height: `aspect`). Memoised: a board redraws often,
 * and a card's sketch only changes with its own strokes.
 */
export const SketchSvg = memo(function SketchSvg({ strokes, aspect }: { strokes: readonly Stroke[]; aspect: number }) {
  const height = 1000;
  const width = Math.round(height * aspect);
  return (
    <svg
      aria-hidden="true"
      data-sketch=""
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full text-text"
    >
      {strokes.map((stroke) => (
        // At least 1% of the frame's height: about a pixel on a card.
        <StrokeShape key={stroke.id} stroke={stroke} width={width} height={height} minLine={10} />
      ))}
    </svg>
  );
});
