import type Konva from 'konva';
import { memo, useEffect, useLayoutEffect, useMemo, useState, type ReactElement } from 'react';
import { Group, Rect } from 'react-konva';
import { elementsFor, staleFor, type MadeFor } from './itemCache';
import type { CanvasColours, CanvasItem, Point } from './types';

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
const ItemNode = memo(function ItemNode({ item, colours, zoom, inView, ratio, register }: ItemNodeProps) {
  // `ratio` is not read here: `draw` reads window.devicePixelRatio, and it is a prop only so that a change of it draws again.
  // The drawing in the box, kept while what it is drawn from is the same (6.18 last review): an item moved by a drag, or
  // drawn anew past its box only (a plan's cone cut live), is a new object with the same `draw`, and its drawing in the
  // box (an icon's dozens of shapes) was made again on every pointer move. `draw` reads only its context, so the same
  // function at the same size, colours and zoom draws the same.
  const { draw, width, height } = item;
  const body = useMemo(
    () => (draw ? draw({ width, height, colours, zoom, inView }) : <Rect width={width} height={height} fill={colours.raised} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} />),
    // `ratio`: a change of screen draws again, as it always has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draw, width, height, colours, zoom, inView, ratio],
  );
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
        {body}
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
  /** The view's centre in the world, this instant: the catch-up starts from it. Left out of the comparison, as `liveZoom` is. */
  centre: Point;
  ratio: number;
  register: RegisterNode;
  /**
   * Called after every render this list commits, with how many of its items are left at an older zoom: a render of the
   * catch-up's alone changes nodes the canvas has not seen, so it fits the screen-sized ones again (screenSized.ts) for
   * `liveZoom`: the view's zoom then, since a catch-up runs only while the view is not zooming.
   */
  onDrawn?: (stale: number, liveZoom: number) => void;
}

/** The same items, one by one (the list is a new array on every render; its items are not). */
export const sameItems = (a: readonly CanvasItem[], b: readonly CanvasItem[]): boolean => a.length === b.length && a.every((item, i) => item === b[i]);

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a === b || (a.size === b.size && [...a].every((id) => b.has(id)));

/**
 * How many plan items left at an older zoom are made for the zoom now in each frame after a settle (6.11): in view first,
 * nearest the view's centre, then the hidden ones. Measured in a dev build on the 300-item plan: 24 keeps each frame at 17
 * to 33 ms and has all 300 at the new zoom about 0.4 s after the last wheel step; 8 took 0.8 s.
 */
export const CATCH_UP = 24;

/** Whether the view is zooming (its zoom not the one the items are drawn for): the catch-up waits for the next settle. */
const zooming = (props: ItemNodesProps): boolean => props.liveZoom !== props.zoom;

export const ItemNodes = memo(
  function ItemNodes({ items, colours, zoom, liveZoom, away, hidden, centre, ratio, register, onDrawn }: ItemNodesProps) {
    const [made] = useState(() => new Map<string, MadeFor<ReactElement>>());
    // The catch-up's frames: a render the tick asked for makes CATCH_UP plan items for the zoom now; any other render (the
    // settle itself above all) makes none of them, so a settle costs a frame of its own and the items come a slice a frame.
    // While the view zooms again nothing is made for a zoom about to be left: the next settle starts over from its centre.
    const [tick, setTick] = useState(0);
    const [pace] = useState(() => ({ tick: 0 }));
    const still = liveZoom === zoom;
    const catchUp = tick !== pace.tick && still ? CATCH_UP : 0;
    pace.tick = tick;
    useLayoutEffect(() => {
      onDrawn?.(staleFor(made, zoom), liveZoom);
    });
    useEffect(() => {
      if (!still || staleFor(made, zoom) === 0) return;
      const frame = requestAnimationFrame(() => {
        setTick((n) => n + 1);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    });
    const ctx = { colours, zoom, liveZoom, away: away === '' ? null : new Set(away.split('|')), hidden, catchUp, centre, register, ratio };
    return elementsFor(made, items, ctx, (item, inView, at) => <ItemNode key={item.id} item={item} colours={colours} zoom={at} inView={inView} ratio={ratio} register={register} />);
  },
  (was, now) =>
    sameItems(was.items, now.items) &&
    was.colours === now.colours &&
    was.zoom === now.zoom &&
    was.away === now.away &&
    sameSet(was.hidden, now.hidden) &&
    was.ratio === now.ratio &&
    was.register === now.register &&
    was.onDrawn === now.onDrawn &&
    // A plan's list is drawn again once as a zoom starts, so its catch-up stops there; a board's has nothing waiting.
    (zooming(was) === zooming(now) || !now.items.some((item) => item.sameInAndOut === true)),
);
