import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../core/i18n';
import { boundsOf, centreOf } from './hitTest';
import type { Geometry, Point, Rect, Size, Viewport } from './types';
import { unionBounds, visibleWorld } from './viewport';

// The minimap (decision 11), bottom right over the canvas: every item as a box and the view as a rectangle. A click or
// a drag in it moves the view. A pointer convenience: the keyboard has the arrows and Shift+1 to Shift+2 for the same.

export const MINIMAP_WIDTH = 176;
export const MINIMAP_HEIGHT = 120;

interface MinimapProps {
  items: readonly (Geometry & { id: string })[];
  view: Viewport;
  size: Size;
  onCentre: (world: Point) => void;
}

/** What the minimap shows: all the items and the view, with some air. */
export function minimapBounds(items: readonly Geometry[], view: Viewport, size: Size): Rect {
  const all = unionBounds([...items.map(boundsOf), visibleWorld(view, size)]) ?? visibleWorld(view, size);
  const air = Math.max(all.width, all.height) * 0.05;
  return { x: all.x - air, y: all.y - air, width: all.width + air * 2, height: all.height + air * 2 };
}

export function Minimap({ items, view, size, onCentre }: MinimapProps) {
  const holding = useRef(false);
  // The minimap's frame is fixed at the pointer going down and held until it comes up: the bounds include the view, so
  // dragging would otherwise rescale it under the pointer and run away.
  const [frozen, setFrozen] = useState<{ bounds: Rect; scale: number; left: number; top: number } | null>(null);
  const live = minimapBounds(items, view, size);
  const liveScale = Math.min(MINIMAP_WIDTH / live.width, MINIMAP_HEIGHT / live.height);
  const current = {
    bounds: live,
    scale: liveScale,
    // Centred in the box when the world is wider or taller than the box's shape.
    left: (MINIMAP_WIDTH - live.width * liveScale) / 2,
    top: (MINIMAP_HEIGHT - live.height * liveScale) / 2,
  };
  const { bounds, scale, left, top } = frozen ?? current;
  const at = (p: Point): Point => ({ x: left + (p.x - bounds.x) * scale, y: top + (p.y - bounds.y) * scale });
  const view_ = visibleWorld(view, size);
  const corner = at(view_);

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left - left) / scale + bounds.x;
    const y = (event.clientY - box.top - top) / scale + bounds.y;
    onCentre({ x, y });
  };

  return (
    <svg
      role="img"
      aria-label={t('canvas.minimapLabel')}
      width={MINIMAP_WIDTH}
      height={MINIMAP_HEIGHT}
      className="block cursor-pointer touch-none border border-text bg-surface"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        holding.current = true;
        setFrozen(current);
        move(event);
      }}
      onPointerMove={(event) => {
        if (holding.current) move(event);
      }}
      onPointerUp={() => {
        holding.current = false;
        setFrozen(null);
      }}
      onPointerCancel={() => {
        holding.current = false;
        setFrozen(null);
      }}
    >
      {items.map((item) => {
        const c = at(centreOf(item));
        const w = Math.max(1.5, item.width * scale);
        const h = Math.max(1.5, item.height * scale);
        return (
          <rect
            key={item.id}
            data-minimap-item={item.id}
            x={c.x - w / 2}
            y={c.y - h / 2}
            width={w}
            height={h}
            transform={`rotate(${String(item.rotation)} ${String(c.x)} ${String(c.y)})`}
            className="fill-surface-raised stroke-text"
            strokeWidth={1}
          />
        );
      })}
      {/* The view: a heavier rule with a dash, so it reads apart from the boxes without colour. */}
      <rect
        data-minimap-view=""
        x={corner.x}
        y={corner.y}
        width={view_.width * scale}
        height={view_.height * scale}
        className="fill-none stroke-text"
        strokeWidth={2}
        strokeDasharray="4 2"
      />
    </svg>
  );
}
