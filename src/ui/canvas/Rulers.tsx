import { rulerTicks } from './scale';
import type { CanvasColours, CanvasScale, Size, Viewport } from './types';

// The rulers along a scaled canvas's top and left edges (6.2a): a round length at each labelled tick, in the unit the
// screen shows, drawn in the canvas's own colours (a plan's paper and ink, whatever the theme). Only a picture of the
// scale: hidden from screen readers, which hear the scale bar, and never in the way of a click.

/** How deep each ruler is, in screen pixels. */
export const RULER_SIZE = 18;
const TICK = 6;

interface RulersProps {
  view: Viewport;
  size: Size;
  scale: Pick<CanvasScale, 'rounds' | 'label'>;
  colours: CanvasColours;
}

export function Rulers({ view, size, scale, colours }: RulersProps) {
  const across = rulerTicks(view, size, scale, 'x').filter((tick) => tick.screen >= RULER_SIZE);
  const down = rulerTicks(view, size, scale, 'y').filter((tick) => tick.screen >= RULER_SIZE);
  const band = { background: colours.paper, color: colours.ink, borderColor: colours.ink };
  return (
    <div aria-hidden="true" data-rulers="" className="pointer-events-none absolute inset-0 font-mono text-[10px] leading-none">
      <svg className="absolute top-0 left-0 border-b" width={size.width} height={RULER_SIZE} style={band}>
        {across.map((tick) => (
          <g key={tick.at}>
            <line x1={tick.screen} x2={tick.screen} y1={RULER_SIZE - TICK} y2={RULER_SIZE} stroke={colours.ink} strokeWidth={1} />
            <text x={tick.screen + 3} y={RULER_SIZE - 7} fill={colours.ink}>
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
      <svg className="absolute top-0 left-0 border-r" width={RULER_SIZE} height={size.height} style={band}>
        {down.map((tick) => (
          <g key={tick.at}>
            <line x1={RULER_SIZE - TICK} x2={RULER_SIZE} y1={tick.screen} y2={tick.screen} stroke={colours.ink} strokeWidth={1} />
            <text x={RULER_SIZE - 7} y={tick.screen + 3} fill={colours.ink} transform={`rotate(-90 ${String(RULER_SIZE - 7)} ${String(tick.screen + 3)})`}>
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
