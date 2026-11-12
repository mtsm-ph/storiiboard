import { LABEL_FONT_SIZE, type ResolvedLink } from './LinkShapes';
import { tidy } from './placement';
import { labelBox, pathMiddle, routeBetween, type Anchor, type Path } from './routing';
import { isAttached, type CanvasItem, type CanvasLink, type Geometry, type LinkEnd } from './types';

// The connectors as they are drawn now (5.2, 5.7): each end joined to its item, routed, and given its label's patch. What
// is made for a connector is kept while nothing it depends on changes, so a drag or a pan elsewhere on the board hands
// the memoised shapes the very same objects.

/** An end as the router takes it: the item's box and side, or the free point; null when the item isn't there. */
export function anchorOf(boxes: ReadonlyMap<string, Geometry>, end: LinkEnd): Anchor | null {
  if (!isAttached(end)) return { point: { x: end.x, y: end.y } };
  const box = boxes.get(end.item);
  return box ? { box, side: end.side } : null;
}

/** The numbers a path depends on at one end. */
const anchorKey = (a: Anchor): number[] =>
  'point' in a ? [a.point.x, a.point.y] : [a.box.x, a.box.y, a.box.width, a.box.height, a.box.rotation, ['top', 'right', 'bottom', 'left', 'auto'].indexOf(a.side)];

/** What is kept for one connector: its route by the numbers it depends on, and the shape made from it. */
export interface RouteEntry {
  key: string;
  path: Path;
  made?: { original: CanvasLink; link: CanvasLink; typing: boolean; resolved: ResolvedLink };
}

export interface ResolveInput {
  links: readonly CanvasLink[];
  /** The items as the host gave them, and as they are shown (a drag's draft applied). */
  items: readonly CanvasItem[];
  shown: readonly CanvasItem[];
  draft: ReadonlyMap<string, Geometry> | null;
  /** A connector being drawn or re-ended: the ends as the pointer makes them. */
  connecting: { id: string | null; from: LinkEnd; to: LinkEnd } | null;
  editing: string | null;
  /** Where the items under the handles are right now. */
  liveBoxes: ReadonlyMap<string, Geometry> | null;
  routes: Map<string, RouteEntry>;
}

export function resolveLinks({ links, items, shown, draft, connecting, editing, liveBoxes, routes }: ResolveInput): ResolvedLink[] {
  const boxes = new Map(shown.map((item) => [item.id, liveBoxes?.get(item.id) ?? item]));
  // A dragged section carries the free ends of connectors inside it: shown moving with it (the smallest section wins).
  const carried = draft
    ? items
        .flatMap((item) => {
          const to = item.section ? draft.get(item.id) : undefined;
          return to && to.width === item.width && to.height === item.height && (to.x !== item.x || to.y !== item.y) ? [{ box: item, dx: to.x - item.x, dy: to.y - item.y }] : [];
        })
        .sort((p, q) => p.box.width * p.box.height - q.box.width * q.box.height)
    : [];
  const follow = (end: LinkEnd): LinkEnd => {
    if (isAttached(end)) return end;
    const by = carried.find(({ box }) => end.x >= box.x && end.x <= box.x + box.width && end.y >= box.y && end.y <= box.y + box.height);
    return by ? { x: tidy(end.x + by.dx), y: tidy(end.y + by.dy) } : end;
  };
  const out = links.flatMap((original) => {
    const link = connecting?.id === original.id ? { ...original, from: connecting.from, to: connecting.to } : { ...original, from: follow(original.from), to: follow(original.to) };
    const a = anchorOf(boxes, link.from);
    const b = anchorOf(boxes, link.to);
    if (!a || !b) return [];
    // Routed again only when the numbers it depends on changed (a move elsewhere on the board leaves it as it was).
    const key = JSON.stringify([link.route, link.width, anchorKey(a), anchorKey(b)]);
    const cached = routes.get(link.id);
    const path = cached?.key === key ? cached.path : routeBetween(a, b, link.route);
    const typing = editing === link.id;
    // The same connector, drawn the same way, is the same object, so its shape isn't made again. Its ends are the
    // connector's own unless a section carried them.
    const made = cached?.key === key ? cached.made : undefined;
    if (made && made.original === original && made.link.from === link.from && made.link.to === link.to && made.typing === typing && made.resolved.path === path) return [made.resolved];
    const middle = pathMiddle(path);
    const resolved: ResolvedLink = { link, path, middle, patch: link.text !== '' || typing ? labelBox(link.text, middle, LABEL_FONT_SIZE, typing ? 120 : 0) : null };
    routes.set(link.id, { key, path, made: { original, link, typing, resolved } });
    return [resolved];
  });
  // A connector that is no longer on the board is forgotten.
  if (routes.size > links.length) {
    const here = new Set(links.map((link) => link.id));
    for (const id of routes.keys()) if (!here.has(id)) routes.delete(id);
  }
  return out;
}
