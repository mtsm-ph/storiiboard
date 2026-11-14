import type Konva from 'konva';
import { memo, useState, type ReactElement } from 'react';
import { Group, Rect } from 'react-konva';
import { elementsFor, type MadeFor } from './itemCache';
import type { CanvasColours, CanvasItem } from './types';

// The items a canvas draws (5.7). Each item is a memoised node: a pan, a zoom, a marquee or the move of twenty items out of
// four hundred leaves the others exactly as they are, so React neither calls their `draw` nor compares what they drew.
// Without this every pointer move made a React element for every item on the board.

export type RegisterNode = (id: string, node: Konva.Group | null) => void;

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
  ratio: number;
  register: RegisterNode;
}

/** The same items, one by one (the list is a new array on every render; its items are not). */
export const sameItems = (a: readonly CanvasItem[], b: readonly CanvasItem[]): boolean => a.length === b.length && a.every((item, i) => item === b[i]);

export const ItemNodes = memo(
  function ItemNodes({ items, colours, zoom, liveZoom, away, ratio, register }: ItemNodesProps) {
    const [made] = useState(() => new Map<string, MadeFor<ReactElement>>());
    return elementsFor(made, items, { colours, zoom, liveZoom, away: away === '' ? null : new Set(away.split('|')), register, ratio }, (item, inView, at) => (
      <ItemNode key={item.id} item={item} colours={colours} zoom={at} inView={inView} ratio={ratio} register={register} />
    ));
  },
  (was, now) =>
    sameItems(was.items, now.items) && was.colours === now.colours && was.zoom === now.zoom && was.away === now.away && was.ratio === now.ratio && was.register === now.register,
);
