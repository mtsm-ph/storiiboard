import { t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { atLeastMinimum, MIN_SIZE, pasted, tidy } from '../../ui/canvas/placement';
import { sectionContents } from '../../ui/canvas/sections';
import type { CanvasColours, CanvasItem, Geometry, GeometryChange, ReorderMode, SectionLook } from '../../ui/canvas/types';
import { reordered, sortKeysFor } from '../../ui/canvas/zOrder';
import { cardUrl, linkLabel } from './links';
import { clipMediaOf, mediaChildOf, mediaCopyChanges, type ClipMedia } from './itemMedia';
import { mediaFields } from '../../core/media/store';
import { videoFields } from '../../core/media/video';
import { connectorsAttachedTo } from './connectorFields';
import { isLiveKind, liveCardData, liveLabel, LIVE_KINDS, projectIdOf, type LiveKind } from './liveCards';

// A board's items (docs/SBD_FORMAT.md, Boards): `board_item` records under their board. 5.0 had one kind, a rectangle;
// 5.1a adds fill and stroke to the shapes (rectangle, ellipse, triangle, diamond), text boxes and sticky notes. Z order
// is the sibling order: the first is at the back, and bringing to the front is a `move` to the last key.

type Records = Readonly<Record<string, SbdRecord>>;

export const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** 5.1b: a picture (with its `media` child), a video card (with its video `media`) and a link card. */
export const MEDIA_KINDS = ['picture', 'video', 'link'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type ItemKind = ShapeKind | 'text' | 'sticky' | MediaKind | 'section' | LiveKind;
const KINDS: readonly string[] = [...SHAPE_KINDS, 'text', 'sticky', ...MEDIA_KINDS, 'section', ...LIVE_KINDS];
export { isLiveKind, type LiveKind };
export const isShapeKind = (kind: ItemKind): kind is ShapeKind => (SHAPE_KINDS as readonly string[]).includes(kind);
export const isMediaKind = (kind: ItemKind): kind is MediaKind => (MEDIA_KINDS as readonly string[]).includes(kind);

export type Align = 'left' | 'center' | 'right';
export const ALIGNS: readonly Align[] = ['left', 'center', 'right'];

/** The six sticky colours, each light enough for ink text to pass AA (4.5:1; tested). Fixed: board content isn't themed. */
export const STICKY_COLOURS = ['#FFE97A', '#FFC9A8', '#FFB8C8', '#BFE8B0', '#B5DDF5', '#D9C8F0'] as const;
/** The six section tints (5.3), light enough for ink to pass AA (4.5:1; tested) and not to be taken for a sticky. Fixed: board content isn't themed. */
export const SECTION_COLOURS = ['#E4E8D2', '#DCE6EE', '#EEDDD2', '#E6DDEE', '#F2E7C9', '#D6EADF'] as const;
/** The ink on a sticky note, whatever the theme (the brand's ink). */
export const STICKY_INK = '#16150F';
// Board content is never themed (M5): the board's own paper, ink and raised surface are fixed, the light theme's, in
// both themes. A text box with no `color` is ink; an unfilled shape is the raised surface with an ink outline.
export const BOARD_PAPER = '#EEE9DF';
export const BOARD_INK = '#16150F';
export const BOARD_RAISED = '#C9C1B1';
/** The muted ink (the brand's muted text), for a card's second line, fixed like the rest of a board's content. */
export const BOARD_MUTED = '#5E5A52';
/** Truffle, the warning colour (paper text on it), fixed like the rest of a board's content. */
export const BOARD_WARNING = '#A35139';
/** What the canvas draws a board in: fixed, so a board looks the same in light and dark and prints as seen. */
export const BOARD_COLOURS: CanvasColours = { ink: BOARD_INK, paper: BOARD_PAPER, raised: BOARD_RAISED };
/** Swatches for shapes and text: the brand's inks and papers, then a few hues for a board's own use. */
export const SWATCHES: readonly string[] = ['#16150F', '#5E5A52', '#C9C1B1', '#EEE9DF', '#FFFFFF', '#DF5E27', '#FFB162', '#A35139', '#2F6B4F', '#2C5F8A', '#6B4C9A', '#C23B5A'];
export const DEFAULT_FONT_FAMILY = 'Inter Tight';
export const DEFAULT_FONT_SIZE = 24;
export const DEFAULT_STICKY_FONT_SIZE = 20;
/** Konva's line height and the editor's, so the text drawn and the text typed take the same room. */
export const LINE_HEIGHT = 1.2;
/** A sticky note's padding in world units. */
export const STICKY_PADDING = 12;

export interface ItemFields extends Geometry {
  kind: ItemKind;
  /** Shapes: `#RRGGBB`, or null for the board's raised colour (5.0's unfilled rectangle). */
  fill: string | null;
  /** Shapes: `#RRGGBB`, or null for the board's ink outline. */
  stroke: string | null;
  /** A text box's colour (null: the board's ink) or a sticky note's (null: the first sticky colour). */
  color: string | null;
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontItalic: boolean;
  fontSize: number;
  align: Align;
  /** A link card's address (http or https) and the title a person typed for it; '' for none. */
  url: string;
  title: string;
  /** A section's name (5.3); may be empty, and the section then shows "Section". */
  name: string;
  /** The frame a shot card shows, and the scene a scene or palette card shows (5.4); '' for any other kind. */
  shotId: string;
  sceneId: string;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A colour as stored: `#RRGGBB`, upper case; anything else is nothing. */
export function hexColour(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

/** What a person typed into a hex field: with or without the #, three or six digits; null when it isn't a colour. */
export function parseHex(input: string): string | null {
  const text = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) return `#${text.replace(/./g, '$&$&')}`.toUpperCase();
  return hexColour(`#${text}`);
}

/** A font weight as CSS has it, 100 to 900 in steps of 100. */
export const cleanWeight = (value: unknown): number => {
  const n = num(value);
  return n === null ? 400 : Math.min(900, Math.max(100, Math.floor((n + 50) / 100) * 100));
};

export const cleanSize = (value: unknown, fallback: number): number => {
  const n = num(value);
  return n === null || n <= 0 ? fallback : Math.min(1000, Math.max(4, n));
};

/** An item's props, or null when they aren't an item this version knows (a kind from a later version stays in the file, unseen). */
export function itemFields(props: SbdRecord['props']): ItemFields | null {
  const kind = typeof props.kind === 'string' && KINDS.includes(props.kind) ? (props.kind as ItemKind) : null;
  if (kind === null) return null;
  const x = num(props.x);
  const y = num(props.y);
  const width = num(props.width);
  const height = num(props.height);
  if (x === null || y === null || width === null || height === null) return null;
  const sticky = kind === 'sticky';
  const section = kind === 'section';
  return {
    kind,
    x,
    y,
    width: atLeastMinimum(width),
    height: atLeastMinimum(height),
    // A section is always upright.
    rotation: section ? 0 : (num(props.rotation) ?? 0),
    fill: hexColour(props.fill),
    stroke: hexColour(props.stroke),
    // A sticky colour outside the six reads as the first.
    color: sticky
      ? (STICKY_COLOURS.find((c) => c === hexColour(props.color)) ?? STICKY_COLOURS[0])
      : section
        ? (SECTION_COLOURS.find((c) => c === hexColour(props.color)) ?? SECTION_COLOURS[0])
        : hexColour(props.color),
    text: typeof props.text === 'string' ? props.text : '',
    fontFamily: typeof props.font_family === 'string' && props.font_family.trim() !== '' ? props.font_family : DEFAULT_FONT_FAMILY,
    fontWeight: cleanWeight(props.font_weight),
    fontItalic: props.font_italic === true,
    fontSize: cleanSize(props.font_size, sticky ? DEFAULT_STICKY_FONT_SIZE : DEFAULT_FONT_SIZE),
    align: ALIGNS.find((a) => a === props.align) ?? 'left',
    url: kind === 'link' && typeof props.url === 'string' ? props.url : '',
    title: kind === 'link' && typeof props.title === 'string' ? props.title : '',
    name: section && typeof props.name === 'string' ? props.name : '',
    shotId: kind === 'shot_card' && typeof props.shot_id === 'string' ? props.shot_id : '',
    sceneId: (kind === 'scene_card' || kind === 'palette_card') && typeof props.scene_id === 'string' ? props.scene_id : '',
  };
}

/** The board's live items, back to front. */
export function itemsOf(records: Records, boardId: string, withTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId && (withTrashed || r.trashedAt === null) && itemFields(r.props) !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/** A sticky colour by its name, in the language in use. */
export function stickyColourName(hex: string): string {
  const names = [t('moodboard.sticky.yellow'), t('moodboard.sticky.peach'), t('moodboard.sticky.pink'), t('moodboard.sticky.green'), t('moodboard.sticky.blue'), t('moodboard.sticky.lilac')];
  const at = STICKY_COLOURS.findIndex((c) => c === hex);
  return names[at] ?? hex;
}

/** A section tint by its name, in the language in use. */
export function sectionColourName(hex: string): string {
  const names = [t('moodboard.section.sage'), t('moodboard.section.blue'), t('moodboard.section.clay'), t('moodboard.section.lilac'), t('moodboard.section.sand'), t('moodboard.section.mint')];
  const at = SECTION_COLOURS.findIndex((c) => c === hex);
  return names[at] ?? hex;
}

/** A text box's position after its height changes: the top edge of the box, as it is turned, stays where it was. */
export function keepTop(g: Geometry, height: number): { x: number; y: number } {
  const turn = (g.rotation * Math.PI) / 180;
  const half = (height - g.height) / 2;
  const cx = g.x + g.width / 2 - Math.sin(turn) * half;
  const cy = g.y + g.height / 2 + Math.cos(turn) * half;
  return { x: tidy(cx - g.width / 2), y: tidy(cy - height / 2) };
}

export const KIND_LABEL: Readonly<Record<ItemKind, () => string>> = {
  rect: () => t('moodboard.item.rect'),
  ellipse: () => t('moodboard.item.ellipse'),
  triangle: () => t('moodboard.item.triangle'),
  diamond: () => t('moodboard.item.diamond'),
  text: () => t('moodboard.item.text'),
  sticky: () => t('moodboard.item.sticky'),
  picture: () => t('moodboard.item.picture'),
  video: () => t('moodboard.item.video'),
  link: () => t('moodboard.item.link'),
  section: () => t('moodboard.item.section'),
  shot_card: () => t('moodboard.item.shot_card'),
  scene_card: () => t('moodboard.item.scene_card'),
  palette_card: () => t('moodboard.item.palette_card'),
  brand_card: () => t('moodboard.item.brand_card'),
};

export const isTextKind = (kind: ItemKind): kind is 'text' | 'sticky' => kind === 'text' || kind === 'sticky';

/** What a screen reader hears for an item: a card by its own name, "Link: Look book", "Video: A001.MP4", "Picture: IMG_4012.JPG". */
export function announcedAs(records: Records, id: string, fields: ItemFields): string {
  if (isLiveKind(fields.kind)) return liveLabel(liveCardData(records, projectIdOf(records, id), { kind: fields.kind, shotId: fields.shotId, sceneId: fields.sceneId }));
  const named = (key: 'moodboard.announce.picture' | 'moodboard.announce.video' | 'moodboard.announce.link', name: string) => (name.trim() === '' ? KIND_LABEL[fields.kind]() : t(key, { name }));
  if (fields.kind === 'link') return named('moodboard.announce.link', linkLabel(fields.url, fields.title));
  if (fields.kind === 'picture') {
    const media = mediaChildOf(records, id, 'image');
    return named('moodboard.announce.picture', (media ? mediaFields(media.props)?.sourceName : '') ?? '');
  }
  if (fields.kind === 'video') {
    const media = mediaChildOf(records, id, 'video');
    return named('moodboard.announce.video', (media ? videoFields(media.props)?.sourceName : '') ?? '');
  }
  return KIND_LABEL[fields.kind]();
}

/** A section's name is set in this size, in Inter Tight, above its top left corner (5.3). */
export const SECTION_NAME_SIZE = 16;
export const SECTION_TAB_HEIGHT = 24;

/** Measures a section's name in Inter Tight bold at its size; set by textFit.ts, which has Konva to measure with. */
let nameWidth: ((text: string) => number) | null = null;
export const setNameMeasurer = (measure: ((text: string) => number) | null): void => {
  nameWidth = measure;
};

/** What a section is called where it shows: its name, or "Section" when it has none. */
export const sectionTitle = (name: string): string => (name.trim() === '' ? t('moodboard.item.section') : name);

/** The name tab above a section's corner, relative to it: as wide as its name needs (an estimate, no wider than the section). */
export function sectionTab(fields: Pick<ItemFields, 'name' | 'width'>): SectionLook['tab'] {
  const title = sectionTitle(fields.name);
  // Measured in the face it is drawn in where the page can (textFit.ts); an estimate where it can't.
  const wanted = Math.ceil((nameWidth?.(title) ?? title.length * SECTION_NAME_SIZE * 0.6) + 16);
  return { x: 0, y: -SECTION_TAB_HEIGHT, width: Math.min(fields.width, Math.max(72, wanted)), height: SECTION_TAB_HEIGHT };
}

/** What the canvas draws, back to front (without drawing: src/features/moodboards/drawing.tsx adds that). */
export function canvasItems(records: Records, boardId: string): CanvasItem[] {
  const live = itemsOf(records, boardId).flatMap((record) => {
    const fields = itemFields(record.props);
    return fields ? [{ id: record.id, ...fields }] : [];
  });
  return live.map((fields): CanvasItem => {
    const { id } = fields;
    return {
      id,
      x: fields.x,
      y: fields.y,
      width: fields.width,
      height: fields.height,
      rotation: fields.rotation,
      // A section is announced with its name and how many items it holds (5.3).
      label:
        fields.kind === 'section'
          ? fields.name.trim() === ''
            ? tn('moodboard.announce.sectionUnnamed', sectionContents(fields, live).length)
            : tn('moodboard.announce.section', sectionContents(fields, live).length, { name: fields.name.trim() })
          : announcedAs(records, id, fields),
      editable: isTextKind(fields.kind) || fields.kind === 'section',
      // A shot or scene card jumps back to the storyboard, a palette card opens its editor, the brand kit's Settings (5.4).
      openable: fields.kind === 'video' || fields.kind === 'link' || isLiveKind(fields.kind),
      // A picture, video or live card keeps its shape when resized.
      keepRatio: fields.kind === 'picture' || fields.kind === 'video' || isLiveKind(fields.kind),
      // A sticky, shape or text box can be copied with a connector (5.2).
      quick: isTextKind(fields.kind) || isShapeKind(fields.kind),
      ...(fields.kind === 'section' ? { section: { tab: sectionTab(fields) } } : {}),
    };
  });
}

const geometryProps = (g: Geometry) => ({ x: g.x, y: g.y, width: g.width, height: g.height, rotation: g.rotation });

/**
 * A text box as it is measured: how tall it is for its text, font and width. The page measures with Konva
 * (src/features/moodboards/textFit.ts); tests and anywhere without a canvas use the estimate below.
 */
export interface TextBox {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontItalic: boolean;
  fontSize: number;
  align: Align;
  width: number;
}
export type MeasureText = (box: TextBox) => number;

/** Without a canvas: an average glyph is about 0.55 of the size wide; lines break at spaces. Never less than one line. */
export const estimateTextHeight: MeasureText = (box) => {
  const perLine = Math.max(1, Math.floor(box.width / (box.fontSize * 0.55)));
  let lines = 0;
  for (const paragraph of box.text.split('\n')) {
    let used = 0;
    let count = 1;
    for (const word of paragraph.split(' ')) {
      const need = word.length + (used > 0 ? 1 : 0);
      if (used + need > perLine && used > 0) {
        count += 1;
        used = word.length;
      } else used += need;
    }
    lines += count;
  }
  return tidy(Math.max(1, lines) * box.fontSize * LINE_HEIGHT);
};

// Every sibling holds a key: the Trash's, the kinds this version doesn't show and the connectors (which sit at the back) too,
// so a new item never ties with one of them.
const lastKey = (records: Records, boardId: string): string | null =>
  Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId)
    .reduce<string | null>((last, r) => (last === null || r.sortKey > last ? r.sortKey : last), null);

/** An item to make: its place and kind, and whatever style it begins with (the rest is the kind's default). */
export type ItemSeed = Geometry & { kind: ItemKind } & Partial<Omit<ItemFields, keyof Geometry | 'kind'>>;

/** The props written for a new item: its kind's own, nothing it doesn't use. */
export function propsFor(seed: ItemSeed): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = { kind: seed.kind, ...geometryProps(seed) };
  if (isShapeKind(seed.kind)) {
    if (seed.fill) props.fill = seed.fill;
    if (seed.stroke) props.stroke = seed.stroke;
    return props;
  }
  if (seed.kind === 'picture' || seed.kind === 'video') return props;
  // A live card names its record and nothing else (5.4): what it draws is read from the project each time.
  if (seed.kind === 'shot_card') return { ...props, shot_id: seed.shotId ?? '' };
  if (seed.kind === 'scene_card' || seed.kind === 'palette_card') return { ...props, scene_id: seed.sceneId ?? '' };
  if (seed.kind === 'brand_card') return props;
  if (seed.kind === 'section') {
    props.rotation = 0;
    props.name = seed.name ?? '';
    props.color = seed.color ?? SECTION_COLOURS[0];
    return props;
  }
  if (seed.kind === 'link') {
    props.url = seed.url ?? '';
    if (seed.title) props.title = seed.title;
    return props;
  }
  props.text = seed.text ?? '';
  props.font_family = seed.fontFamily ?? DEFAULT_FONT_FAMILY;
  props.font_weight = seed.fontWeight ?? 400;
  props.font_italic = seed.fontItalic ?? false;
  props.font_size = seed.fontSize ?? (seed.kind === 'sticky' ? DEFAULT_STICKY_FONT_SIZE : DEFAULT_FONT_SIZE);
  props.align = seed.align ?? 'left';
  if (seed.kind === 'sticky') props.color = seed.color ?? STICKY_COLOURS[0];
  else if (seed.color) props.color = seed.color;
  return props;
}

/** Items made at the front, in order, each after the last. A given id is used for the first (an item typed into before it existed). */
export function createItems(records: Records, boardId: string, seeds: readonly ItemSeed[], firstId?: string): { ids: string[]; changes: Change[] } {
  let previous = lastKey(records, boardId);
  const ids: string[] = [];
  const changes: Change[] = [];
  for (const seed of seeds) {
    const id = ids.length === 0 && firstId ? firstId : crypto.randomUUID();
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey, props: propsFor(seed) } });
  }
  return { ids, changes };
}

/** Rectangles made at the front, in order, each after the last. */
export function createRects(records: Records, boardId: string, geometries: readonly Geometry[]): { ids: string[]; changes: Change[] } {
  return createItems(records, boardId, geometries.map((g) => ({ ...g, kind: 'rect' as const })));
}

const boxOf = (fields: ItemFields, width = fields.width, text = fields.text): TextBox => ({
  text,
  fontFamily: fields.fontFamily,
  fontWeight: fields.fontWeight,
  fontItalic: fields.fontItalic,
  fontSize: fields.fontSize,
  align: fields.align,
  width,
});

/**
 * A finished move, resize or rotate: one update per item that changed, all one op group. An item whose props already
 * equal the new ones is left out, so the canvas never writes an empty step. A text box's height follows its text: when
 * its width changed it is worked out again for the new width.
 */
export function geometryChanges(records: Records, changes: readonly GeometryChange[], measure: MeasureText = estimateTextHeight): Change[] {
  return changes.flatMap((c): Change[] => {
    const record = records[c.id];
    if (record?.type !== 'board_item' || record.trashedAt !== null) return [];
    // Against the item as it reads (a missing rotation is 0), so a drag back to where it began writes nothing.
    const now = itemFields(record.props);
    let next = c;
    if (now?.kind === 'text') {
      if (c.width === now.width && c.height !== now.height) {
        // A text box is as tall as its text: stretching it by the top or bottom handle snaps back.
        next = { ...c, x: now.x, y: now.y, height: now.height };
      } else if (c.width !== now.width) {
        const height = Math.max(MIN_SIZE, measure(boxOf(now, c.width)));
        next = { ...c, ...keepTop(c, height), height };
      }
    }
    // A section is always upright.
    if (now?.kind === 'section') next = { ...next, rotation: 0 };
    const set = geometryProps(next);
    if (now && Object.entries(set).every(([key, value]) => now[key as keyof typeof now] === value)) return [];
    return [{ kind: 'update', id: c.id, set }];
  });
}

/**
 * A nudge: a distance, added to each item as it is when the edit is written, so two quick presses make 2 units, not the
 * same 1 twice.
 */
export function nudgeChanges(records: Records, ids: readonly string[], dx: number, dy: number): Change[] {
  return ids.flatMap((id): Change[] => {
    const fields = records[id]?.type === 'board_item' && records[id].trashedAt === null ? itemFields(records[id].props) : null;
    if (!fields) return [];
    return geometryChanges(records, [{ id, ...fields, x: tidy(fields.x + dx), y: tidy(fields.y + dy) }]);
  });
}

/**
 * A reorder of the selected items: `move`s for them alone, to keys that give the new order. Sections are drawn under
 * everything else (5.3), so they are reordered among sections only, and the other items among themselves: a section sent
 * to the front is the front of the sections.
 */
export function reorderChanges(records: Records, boardId: string, selected: readonly string[], mode: ReorderMode): Change[] {
  const live = itemsOf(records, boardId);
  const sections = live.filter((r) => itemFields(r.props)?.kind === 'section').map((r) => r.id);
  const others = live.filter((r) => itemFields(r.props)?.kind !== 'section').map((r) => r.id);
  let now = records;
  const out: Change[] = [];
  for (const ids of [sections, others]) {
    const chosen = new Set(selected.filter((id) => ids.includes(id)));
    if (chosen.size === 0) continue;
    const moves = reorderAmong(now, boardId, ids, chosen, mode);
    out.push(...moves);
    // The second group is worked out against the keys the first one gave.
    now = { ...now, ...Object.fromEntries(moves.flatMap((m) => (m.kind === 'move' && now[m.id] ? [[m.id, { ...(now[m.id] as SbdRecord), sortKey: m.sortKey }]] : []))) };
  }
  return out;
}

/** One group of items (back to front) reordered: the chosen ones among them go forward, backward, to the front or to the back. */
function reorderAmong(records: Records, boardId: string, liveIds: readonly string[], chosen: ReadonlySet<string>, mode: ReorderMode): Change[] {
  const nextLive = reordered(liveIds, chosen, mode);
  // Already where it was asked to go among the items that show: nothing to write, whatever the Trash holds.
  if (nextLive.every((id, i) => id === liveIds[i])) return [];
  // Every sibling holds a key, the Trash's and the kinds this version doesn't show too: they never move, and a new key
  // is made between them, or it could equal one of theirs and tie when they come back.
  const all = Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((r) => r.id);
  const fixed = all.filter((id) => !chosen.has(id));
  let after: string[];
  if (mode === 'front') after = [...fixed, ...nextLive.filter((id) => chosen.has(id))];
  else if (mode === 'back') after = [...nextLive.filter((id) => chosen.has(id)), ...fixed];
  else {
    after = [...fixed];
    // Each moved item goes right after the item before it in the new live order.
    nextLive.forEach((id, i) => {
      if (!chosen.has(id)) return;
      const before = nextLive[i - 1];
      after.splice(before === undefined ? 0 : after.indexOf(before) + 1, 0, id);
    });
  }
  const keys = sortKeysFor(all, after, new Map(all.map((id) => [id, records[id]?.sortKey ?? ''])), chosen);
  return [...keys].map(([id, sortKey]): Change => ({ kind: 'move', id, parentId: boardId, sortKey }));
}

/** The items to the Trash, in one group, and the connectors attached to them with them (5.2). */
export function trashItemsChanges(records: Records, ids: readonly string[]): Change[] {
  const live = ids.filter((id) => records[id]?.type === 'board_item' && records[id].trashedAt === null);
  const also = connectorsAttachedTo(records, live).filter((r) => !live.includes(r.id));
  return [...live, ...also.map((r) => r.id)].map((id): Change => ({ kind: 'trash', id }));
}

/** What Copy keeps: the selected items, kind, geometry and style, back to front; a picture or video card's media too. */
export type ClipItem = ItemFields & { media: ClipMedia | null };

export function clipOf(records: Records, boardId: string, selected: readonly string[]): ClipItem[] {
  return itemsOf(records, boardId).flatMap((record) => {
    const fields = selected.includes(record.id) ? itemFields(record.props) : null;
    if (!fields) return [];
    return [{ ...fields, media: fields.kind === 'picture' || fields.kind === 'video' ? clipMediaOf(records, record.id, fields.kind) : null }];
  });
}

/**
 * Pasted at the pointer or offset 16 units from the originals, at the front. A picture or video card gets a new media
 * record naming the same stored file (no second copy of the bytes).
 */
export function pasteChanges(
  records: Records,
  boardId: string,
  clip: readonly ClipItem[],
  at: { x: number; y: number } | null,
): { ids: string[]; changes: Change[]; videos: { from: string; to: string }[] } {
  const placed = pasted(clip, at);
  const made = createItems(records, boardId, placed);
  const videos: { from: string; to: string }[] = [];
  const changes = made.changes.flatMap((change, i) => {
    const media = placed[i]?.media;
    const id = made.ids[i];
    if (!media || !id) return [change];
    const copied = mediaCopyChanges(id, media);
    if (copied.video) videos.push(copied.video);
    return [change, ...copied.changes];
  });
  return { ids: made.ids, changes, videos };
}

/** A property change from the properties strip: what each kind takes of it is decided in `styleChanges`. */
export interface StylePatch {
  /** Shapes. */
  fill?: string;
  stroke?: string;
  /** Text boxes. */
  textColor?: string;
  /** Sticky notes. */
  stickyColor?: string;
  /** Sections (5.3): one of the six tints. */
  sectionColor?: string;
  /** Text boxes and sticky notes. */
  fontFamily?: string;
  fontWeight?: number;
  fontItalic?: boolean;
  fontSize?: number;
  align?: Align;
}

/**
 * A style change on several items: one update per item that has something to change, all one op group. Shapes take
 * fill and stroke; text boxes the text colour; stickies their colour; both the font and alignment. A text box whose
 * font or size changed gets its height worked out again.
 */
export function styleChanges(records: Records, ids: readonly string[], patch: StylePatch, measure: MeasureText = estimateTextHeight): Change[] {
  return ids.flatMap((id): Change[] => {
    const record = records[id];
    const now = record?.type === 'board_item' && record.trashedAt === null ? itemFields(record.props) : null;
    // Pictures, video cards and links have no style to set here (a link's words are linkChanges); nor have live cards.
    if (!now || isMediaKind(now.kind) || isLiveKind(now.kind)) return [];
    const wanted: Record<string, string | number | boolean | undefined> = {};
    if (isShapeKind(now.kind)) {
      wanted.fill = patch.fill;
      wanted.stroke = patch.stroke;
    } else if (now.kind === 'section') {
      // Only the six tints are sections' colours.
      wanted.color = SECTION_COLOURS.find((c) => c === patch.sectionColor);
    } else {
      wanted.color = now.kind === 'text' ? patch.textColor : patch.stickyColor;
      wanted.font_family = patch.fontFamily;
      wanted.font_weight = patch.fontWeight;
      wanted.font_italic = patch.fontItalic;
      wanted.font_size = patch.fontSize === undefined ? undefined : cleanSize(patch.fontSize, now.fontSize);
      wanted.align = patch.align;
    }
    const current: Record<string, unknown> = {
      fill: now.fill,
      stroke: now.stroke,
      color: now.color,
      font_family: now.fontFamily,
      font_weight: now.fontWeight,
      font_italic: now.fontItalic,
      font_size: now.fontSize,
      align: now.align,
    };
    const set: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(wanted)) {
      if (value !== undefined && current[key] !== value) set[key] = value;
    }
    if (Object.keys(set).length === 0) return [];
    if (now.kind === 'text' && ('font_family' in set || 'font_weight' in set || 'font_italic' in set || 'font_size' in set)) {
      const after: ItemFields = {
        ...now,
        fontFamily: typeof set.font_family === 'string' ? set.font_family : now.fontFamily,
        fontWeight: typeof set.font_weight === 'number' ? set.font_weight : now.fontWeight,
        fontItalic: typeof set.font_italic === 'boolean' ? set.font_italic : now.fontItalic,
        fontSize: typeof set.font_size === 'number' ? set.font_size : now.fontSize,
      };
      const height = Math.max(MIN_SIZE, measure(boxOf(after)));
      if (height !== now.height) Object.assign(set, { height, ...keepTop(now, height) });
    }
    return [{ kind: 'update', id, set }];
  });
}

/** Editing in place ended on an item that exists: its text (and a text box's height with it), if either changed. */
export function textEditChanges(records: Records, id: string, text: string, measure: MeasureText = estimateTextHeight): Change[] {
  const record = records[id];
  const now = record?.type === 'board_item' && record.trashedAt === null ? itemFields(record.props) : null;
  // A section's name is one line: line breaks typed into it become spaces.
  if (now?.kind === 'section') {
    const name = text.replace(/\s*\n\s*/g, ' ');
    return name === now.name ? [] : [{ kind: 'update', id, set: { name } }];
  }
  if (!now || !isTextKind(now.kind)) return [];
  const set: Record<string, string | number> = {};
  if (text !== now.text) set.text = text;
  if (now.kind === 'text') {
    const height = Math.max(MIN_SIZE, measure(boxOf(now, now.width, text)));
    if (height !== now.height) Object.assign(set, { height, ...keepTop(now, height) });
  }
  return Object.keys(set).length === 0 ? [] : [{ kind: 'update', id, set }];
}

/** A link card's address and title, edited in the properties strip: only what changed. The address must be an http(s) one. */
export function linkChanges(records: Records, id: string, patch: { url?: string; title?: string }): Change[] {
  const record = records[id];
  const now = record?.type === 'board_item' && record.trashedAt === null ? itemFields(record.props) : null;
  if (now?.kind !== 'link') return [];
  const set: Record<string, string> = {};
  const url = patch.url === undefined ? undefined : cardUrl(patch.url);
  // An address that isn't http or https is never written.
  if (patch.url !== undefined && url === null) return [];
  if (url !== undefined && url !== null && url !== now.url) set.url = url;
  const unset: string[] = [];
  if (patch.title !== undefined && patch.title !== now.title) {
    if (patch.title === '') unset.push('title');
    else set.title = patch.title;
  }
  if (Object.keys(set).length === 0 && unset.length === 0) return [];
  return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
}

/** A new text box or sticky note with what was typed in it: a text box's height is its text's. */
export function seedWithText(seed: ItemSeed, text: string, measure: MeasureText = estimateTextHeight): ItemSeed {
  if (seed.kind !== 'text') return { ...seed, text };
  const fields = itemFields(propsFor({ ...seed, text }));
  return { ...seed, text, height: fields ? Math.max(MIN_SIZE, measure(boxOf(fields))) : seed.height };
}
