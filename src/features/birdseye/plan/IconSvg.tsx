import type { CSSProperties } from 'react';
import { iconContentBox, iconShapesOf } from './iconDraw';
import type { PlanIcon } from '../../../ui/icons/plan/planIcons';

// A plan icon as inline SVG, for the Library's buttons and the drag ghost (6.3, third review round): the same shapes the
// plan draws (iconBoxes.ts), in the kit's own colours, its view box the box of its ink, so a ghost at the item's real
// size shows what the drop will draw. Lines are non-scaling, as on the plan: the kit's weight in screen pixels. Inline
// SVG, unlike an SVG in an <img>, holds non-scaling strokes in every engine and sets its text in the page's own fonts.

/** The view box: the ink's box, a box with no extent one way (a line) made as deep as it is wide, round its middle. */
function viewBoxOf(icon: PlanIcon): string {
  const box = iconContentBox(icon);
  const w = box.width > 0 ? box.width : box.height;
  const h = box.height > 0 ? box.height : box.width;
  const x = box.width > 0 ? box.x : box.x - w / 2;
  const y = box.height > 0 ? box.y : box.y - h / 2;
  return `${String(x)} ${String(y)} ${String(w)} ${String(h)}`;
}

export function IconSvg({ icon, width, height, stretch = false, className, style }: { icon: PlanIcon; width: number; height: number; stretch?: boolean; className?: string | undefined; style?: CSSProperties | undefined }) {
  const parts = iconShapesOf(icon.id) ?? [];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={viewBoxOf(icon)}
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
      overflow="visible"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {parts.map((part, i) =>
        part.kind === 'path' ? (
          <path
            key={String(i)}
            d={part.d}
            fill={part.fill ?? 'none'}
            fillOpacity={part.fillOpacity}
            stroke={part.stroke ?? 'none'}
            strokeOpacity={part.strokeOpacity}
            strokeWidth={part.strokeWidth}
            strokeDasharray={part.dash === null ? undefined : part.dash.join(' ')}
            strokeLinecap={part.lineCap}
            strokeLinejoin={part.lineJoin}
            opacity={part.opacity}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <text
            key={String(i)}
            x={part.x}
            y={part.y}
            fontFamily={`"${part.family}", monospace`}
            fontWeight={part.weight}
            fontSize={part.size}
            textAnchor={part.anchor}
            fill={part.fill}
            fillOpacity={part.fillOpacity}
            opacity={part.opacity}
          >
            {part.text}
          </text>
        ),
      )}
    </svg>
  );
}
