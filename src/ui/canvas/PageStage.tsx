import type Konva from 'konva';
import { useLayoutEffect, useRef, useState } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import { LABEL_FONT_SIZE, LinkShape, type ResolvedLink } from './LinkShapes';
import { drawOrder } from './sections';
import { labelBox, pathMiddle, routeBetween, type Anchor } from './routing';
import { isAttached, type CanvasColours, type CanvasItem, type CanvasLink, type Geometry, type LinkEnd, type Size } from './types';

// One page of a deck, drawn read-only and scaled to fit a space (5.5): the canvas's own renderer without its gestures. The page
// is drawn first, then the frames inside it (sections, with their names), then the connectors, then the items, all clipped to
// the page. Live cards read the project as they are drawn, and pictures are asked for at full size. Nothing here listens.

/** Pictures are drawn as if zoomed in this far, so a presentation asks for each at full size. */
const PRESENT_ZOOM = 4;
/** An export asks for every picture at its stored size, however small it is drawn. */
const PRINT_ZOOM = 1000;

const anchorOf = (boxes: ReadonlyMap<string, Geometry>, end: LinkEnd): Anchor | null => {
  if (!isAttached(end)) return { point: { x: end.x, y: end.y } };
  const box = boxes.get(end.item);
  return box ? { box, side: end.side } : null;
};

interface PageStageProps {
  /** The page itself: its box and how it is drawn. */
  page: CanvasItem;
  /** What lies inside it, back to front. */
  items: readonly CanvasItem[];
  links: readonly CanvasLink[];
  /** The room it is fitted into, in screen pixels. */
  size: Size;
  colours: CanvasColours;
  /** Drawn to be exported (5.6a): the same drawing, pictures at their stored size and no outline round the page. */
  print?: boolean;
  /** The zoom pictures are asked for at, in place of the one `print` or a presentation gives: 0 asks for the small picture only. */
  pictureZoom?: number;
}

export function PageStage({ page, items, links, size, colours, print = false, pictureZoom }: PageStageProps) {
  const stage = useRef<Konva.Stage>(null);
  // What the stage actually drew: the items whose nodes hold a shape, read back from Konva (the canvas is pixels), for the tests.
  const [drawnIds, setDrawnIds] = useState<string[]>([]);
  // Every render, but it sets state only when what was drawn differs, so it settles at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const ids = (stage.current?.find('.stage-item') ?? []).filter((node) => (node as Konva.Group).find('Shape').length > 0).map((node) => node.id());
    setDrawnIds((now) => (JSON.stringify(now) === JSON.stringify(ids) ? now : ids));
  });
  const scale = Math.min(size.width / page.width, size.height / page.height);
  const offsetX = (size.width - page.width * scale) / 2 - page.x * scale;
  const offsetY = (size.height - page.height * scale) / 2 - page.y * scale;
  const boxes = new Map(items.map((item) => [item.id, item]));
  const resolved = links.flatMap((link): ResolvedLink[] => {
    const a = anchorOf(boxes, link.from);
    const b = anchorOf(boxes, link.to);
    if (!a || !b) return [];
    const path = routeBetween(a, b, link.route);
    const middle = pathMiddle(path);
    return [{ link, path, middle, patch: link.text !== '' ? labelBox(link.text, middle, LABEL_FONT_SIZE, 0) : null }];
  });
  const draw = (item: CanvasItem, withTab: boolean) => (
    <Group key={item.id}>
      <Group id={item.id} name="stage-item" x={item.x + item.width / 2} y={item.y + item.height / 2} offsetX={item.width / 2} offsetY={item.height / 2} rotation={item.rotation} listening={false}>
        {item.draw?.({ width: item.width, height: item.height, colours, zoom: pictureZoom ?? (print ? PRINT_ZOOM : PRESENT_ZOOM), inView: true, present: true, ...(print ? { print: true } : {}) })}
      </Group>
      {withTab && item.section?.drawTab && (
        <Group x={item.x} y={item.y} listening={false}>
          {item.section.drawTab({ colours, zoom: scale })}
        </Group>
      )}
    </Group>
  );
  // Frames inside the page in the canvas's own order: one wholly inside another is drawn above it (5.3).
  const frames = drawOrder(items.filter((item) => item.section));
  return (
    // data-stage-items names what is drawn, for the end-to-end tests (the canvas itself is pixels).
    <div data-stage-items={JSON.stringify(drawnIds)}>
    <Stage ref={stage} width={size.width} height={size.height} listening={false}>
      <Layer x={offsetX} y={offsetY} scaleX={scale} scaleY={scale} listening={false}>
        <Group clipX={page.x} clipY={page.y} clipWidth={page.width} clipHeight={page.height}>
          {draw(page, false)}
          {frames.map((item) => draw(item, true))}
          {resolved.map((r) => (
            <LinkShape key={r.link.id} resolved={r} colours={colours} selected={false} hideText={false} handles={false} zoom={scale} />
          ))}
          {items.filter((item) => !item.section).map((item) => draw(item, false))}
        </Group>
      </Layer>
    </Stage>
    </div>
  );
}
