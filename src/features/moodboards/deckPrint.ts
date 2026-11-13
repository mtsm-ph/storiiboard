import { getLocale } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { CanvasItem, CanvasLink } from '../../ui/canvas/types';
import { cardInfo } from './cards';
import { canvasLinks } from './connectors';
import { fieldValue, type FieldValue } from './deckFields';
import { withDrawing } from './drawing';
import { fontsStore } from './fonts';
import { canvasItems, hasTextStyle, itemFields, itemsOf, pageNumbers, type ItemFields } from './items';
import { isLiveKind, liveCardData, type LiveCardData } from './liveCards';
import type { PageFormat, PageOrientation } from './pageFormats';
import { presentPages } from './pages';

// What a deck prints (5.6a): the pages Present shows, in the deck's order, each with the items wholly inside it, drawn as the
// board draws them (live cards as they are now, field cards from the project). The same inputs the board view gives its canvas,
// worked out here for a board that isn't on screen, so an export doesn't depend on the view being open.

type Records = Readonly<Record<string, SbdRecord>>;

/** A face a page's text asks for. */
export interface PageFace {
  family: string;
  weight: number;
  italic: boolean;
}

export interface ScenePage {
  id: string;
  /** 1 for the first page in the deck's order. */
  number: number;
  name: string;
  format: PageFormat;
  orientation: PageOrientation;
  /** `#RRGGBB`. */
  background: string;
  /** The page's size in the canvas's units. */
  width: number;
  height: number;
  /** The page itself as the canvas draws it, and what is wholly inside it back to front, and its connectors. */
  page: CanvasItem;
  items: CanvasItem[];
  links: CanvasLink[];
  /** The stored pictures this page draws (picture and video cards, shot and scene cards, the brand card's logo), each once. */
  pictures: string[];
  /** The faces its text is set in (text, stickies, field cards, the brand card's fonts), each once. */
  faces: PageFace[];
}

/** The pages of a deck as an export prints them; none for a board with no pages. */
export function printPages(records: Records, boardId: string, locale: string = getLocale()): ScenePage[] {
  const present = presentPages(records, boardId);
  if (present.length === 0) return [];
  const projectId = records[boardId]?.parentId ?? null;
  const fieldsOf = (id: string): ItemFields | null => itemFields(records[id]?.props ?? {});
  const live = new Map<string, LiveCardData>();
  const fieldValues = new Map<string, FieldValue>();
  for (const record of itemsOf(records, boardId)) {
    const fields = itemFields(record.props);
    if (!fields) continue;
    if (isLiveKind(fields.kind)) live.set(record.id, liveCardData(records, projectId, { kind: fields.kind, shotId: fields.shotId, sceneId: fields.sceneId }, locale));
    if (fields.kind === 'field_card' && fields.field !== '') fieldValues.set(record.id, fieldValue(records, projectId, fields.field, locale));
  }
  const numbers = pageNumbers(itemsOf(records, boardId).flatMap((r) => { const f = itemFields(r.props); return f ? [{ id: r.id, kind: f.kind }] : []; }));
  const drawn = withDrawing(
    canvasItems(records, boardId),
    fieldsOf,
    (id) => {
      const fields = fieldsOf(id);
      // No missing-video set is passed on purpose: a video card whose file is gone prints without its "missing" flag. That flag
      // is an editing hint (relink it), and a deck that goes to a client shows no hints.
      return fields ? cardInfo(records, id, fields, {}) : null;
    },
    (id) => live.get(id) ?? null,
    null,
    fontsStore.getState().version,
    { pageNumbers: numbers, fieldOf: (id) => fieldValues.get(id) ?? null },
  );
  const links = canvasLinks(records, boardId);
  return present.flatMap((page): ScenePage[] => {
    const pageItem = drawn.find((item) => item.id === page.id);
    const fields = fieldsOf(page.id);
    if (!pageItem || !fields) return [];
    const held = new Set(page.items);
    const items = drawn.filter((item) => held.has(item.id));
    const pictures = new Set<string>();
    const faces = new Map<string, PageFace>();
    const face = (family: string, weight: number, italic: boolean) => {
      faces.set(`${family}\n${String(weight)}\n${String(italic)}`, { family, weight, italic });
    };
    for (const item of items) {
      const own = fieldsOf(item.id);
      if (!own) continue;
      if (hasTextStyle(own.kind)) face(own.fontFamily, own.fontWeight, own.fontItalic);
      if (own.kind === 'picture' || own.kind === 'video') {
        const sha = cardInfo(records, item.id, own, {})?.sha256;
        if (sha) pictures.add(sha);
      }
      const data = live.get(item.id);
      if (data?.kind === 'shot_card' && data.sha256) pictures.add(data.sha256);
      if (data?.kind === 'scene_card') for (const frame of data.first) if (frame.sha256) pictures.add(frame.sha256);
      if (data?.kind === 'brand_card') {
        if (data.logoSha256) pictures.add(data.logoSha256);
        for (const family of data.fonts) face(family, 400, false);
      }
    }
    return [
      {
        id: page.id,
        number: page.number,
        name: page.name,
        format: fields.format,
        orientation: fields.orientation,
        background: fields.background,
        width: page.box.width,
        height: page.box.height,
        page: pageItem,
        items,
        links: links.filter((link) => page.connectors.includes(link.id)),
        pictures: [...pictures],
        faces: [...faces.values()],
      },
    ];
  });
}
