import type Konva from 'konva';
import { memo, useEffect, useState, type ReactElement } from 'react';
import { Group, Rect } from 'react-konva';
import { elementsFor, staleFor, type MadeFor } from './itemCache';
import type { CanvasColours, CanvasItem } from './types';

// The items a canvas draws (5.7). Each item is a memoised node: a pan, a zoom, a marquee or the move of twenty items out of
// four hundred leaves the others exactly as they are, so React neither calls their `draw` nor compares what they drew.
// Without this every pointer move made a React element for every item on the board.

export type RegisterNode = (id: string, node: Konva.Group | null) => void;

/** The key an item's drawing past its box is registered under: the handles turn it with the item while they turn it. */
export const beyondKey = (id: string): string => `${id}\u0000beyond`;

/**
 * The Konva name a node drawn past an item's box takes to stay upright (6.4 review: a camera's labels): while the
 * handles turn the item, the canvas turns such nodes back by the live turn, so they never spin with the gesture.
 */
export const UPRIGHT = 'sb-upright';

/** How strongly a dimmed item is drawn (6.2a; DESIGN.md's locked layer at 45%). */
export const DIM_OPACITY = 0.45;

interface ItemNodeProps {
  item: CanvasItem;
  colours: CanvasColours;
  /** The zoom the items are drawn for. It follows the view's zoom a moment after the view stops zooming. */
  zoom: number;
  inView: boolean;
  /** The screen's pixel ratio: a picture picks its size by it, so a change of screen draws the item again. */
  ratio: number;
  register: RegisterNode;
}

/** One item's group (its handles' node), and a section's name tab beside it, drawn in the world. */
const ItemNode = memo(function ItemNode({ item, colours, zoom, inView, register }: ItemNodeProps) {
  // `ratio` is not read here: `draw` reads window.devicePixelRatio, and it is a prop only so that a change of it draws again.
  return (
    <Group opacity={item.dim ? DIM_OPACITY : 1}>
      {item.beyond && (
        // Past the box (6.4: a camera's cone), under it, in a group of its own so the handles hold only the box.
        <Group
          ref={(node) => {
            register(beyondKey(item.id), node);
          }}
          x={item.x + item.width / 2}
          y={item.y + item.height / 2}
          offsetX={item.width / 2}
          offsetY={item.height / 2}
          rotation={item.rotation}
          listening={false}
        >
          {item.beyond.draw({ width: item.width, height: item.height, colours, zoom, inView, rotation: item.rotation })}
        </Group>
      )}
      <Group
        ref={(node) => {
          register(item.id, node);
        }}
        x={item.x + item.width / 2}
        y={item.y + item.height / 2}
        offsetX={item.width / 2}
        offsetY={item.height / 2}
        width={item.width}
        height={item.height}
        rotation={item.rotation}
        listening={false}
      >
        {item.draw ? (
          item.draw({ width: item.width, height: item.height, colours, zoom, inView })
        ) : (
          <Rect width={item.width} height={item.height} fill={colours.raised} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} />
        )}
      </Group>
      {item.section?.drawTab && (
        <Group x={item.x} y={item.y} listening={false}>
          {item.section.drawTab({ colours, zoom })}
        </Group>
      )}
    </Group>
  );
});

interface ItemNodesProps {
  items: readonly CanvasItem[];
  colours: CanvasColours;
  /** The zoom the items are drawn for. It follows the view's zoom a moment after the view stops zooming. */
  zoom: number;
  /** The view's zoom this instant. It is read when an item is made, and left out of the comparison below: a zoom step alone leaves the list as it is. */
  liveZoom: number;
  /** The ids of the items here that are not in the view (a picked one out of sight is still drawn), joined with "|". */
  away: string;
  /** The ids of the items mounted hidden (a plan's out of view: culling.ts's mountedItems); empty for a board. */
  hidden: ReadonlySet<string>;
  ratio: number;
  register: RegisterNode;
}

/** The same items, one by one (the list is a new array on every render; its items are not). */
export const sameItems = (a: readonly CanvasItem[], b: readonly CanvasItem[]): boolean => a.length === b.length && a.every((item, i) => item === b[i]);

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a === b || (a.size === b.size && [...a].every((id) => b.has(id)));

/** How many hidden items left at an older zoom are made for the zoom now in each frame after a settle (6.11 review, M1). */
export const CATCH_UP = 8;

export const ItemNodes = memo(
  function ItemNodes({ items, colours, zoom, liveZoom, away, hidden, ratio, register }: ItemNodesProps) {
    const [made] = useState(() => new Map<string, MadeFor<ReactElement>>());
    // The catch-up's frames: a render the tick asked for makes CATCH_UP hidden items for the zoom now; any other render
    // (the settle itself above all) makes none of them, so a settle costs only the items in view.
    const [tick, setTick] = useState(0);
    const [pace] = useState(() => ({ tick: 0 }));
    const catchUp = tick !== pace.tick ? CATCH_UP : 0;
    pace.tick = tick;
    useEffect(() => {
      if (staleFor(made, zoom) === 0) return;
      const frame = requestAnimationFrame(() => {
        setTick((n) => n + 1);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    });
    return elementsFor(made, items, { colours, zoom, liveZoom, away: away === '' ? null : new Set(away.split('|')), hidden, catchUp, register, ratio }, (item, inView, at) => (
      <ItemNode key={item.id} item={item} colours={colours} zoom={at} inView={inView} ratio={ratio} register={register} />
    ));
  },
  (was, now) =>
    sameItems(was.items, now.items) &&
    was.colours === now.colours &&
    was.zoom === now.zoom &&
    was.away === now.away &&
    sameSet(was.hidden, now.hidden) &&
    was.ratio === now.ratio &&
    was.register === now.register,
);
