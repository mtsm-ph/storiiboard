import type { ReactNode } from 'react';
import { Ellipse, Group, Line, Rect, Text } from 'react-konva';
import { t } from '../../core/i18n';
import type { CanvasItem, DrawContext } from '../../ui/canvas/types';
import type { CardInfo } from './cards';
import { cssFamily, fontsStore } from './fonts';
import { isFrameKind, BOARD_INK, BOARD_MUTED, BOARD_PAPER, BOARD_WARNING, pageTitle, DEFAULT_FONT_FAMILY, LINE_HEIGHT, SECTION_COLOURS, SECTION_NAME_SIZE, SECTION_TAB_HEIGHT, sectionTitle, STICKY_COLOURS, STICKY_INK, STICKY_PADDING, type ItemFields } from './items';
import { linkLabel } from './links';
import { PictureNode } from './PictureNode';
import { DECK_FIELD_LABEL } from './pageFormats';
import type { FieldValue } from './deckFields';
import { drawLive } from './liveDraw';
import { isLiveKind, type LiveCardData } from './liveCards';
import { fontStyleOf, measureText } from './textFit';

// How each kind of board item is drawn, in its own box (0 to width by 0 to height). Colours a person gave an item are
// drawn as stored: board content is never themed. What was never given one reads as the board's own defaults, which the
// canvas passes in as fixed colours (ink text and outlines, the raised surface for an unfilled shape) on the board's
// fixed paper, in light and dark alike; the sticky colours are fixed too, with ink text on them.

const STROKE = 1.5;

function shape(fields: ItemFields, { width, height, colours }: DrawContext): ReactNode {
  const common = { fill: fields.fill ?? colours.raised, stroke: fields.stroke ?? colours.ink, strokeWidth: STROKE, strokeScaleEnabled: false };
  switch (fields.kind) {
    case 'ellipse':
      return <Ellipse x={width / 2} y={height / 2} radiusX={width / 2} radiusY={height / 2} {...common} />;
    case 'triangle':
      return <Line points={[width / 2, 0, width, height, 0, height]} closed {...common} />;
    case 'diamond':
      return <Line points={[width / 2, 0, width, height / 2, width / 2, height, 0, height / 2]} closed {...common} />;
    default:
      return <Rect width={width} height={height} {...common} />;
  }
}

/** The text of a box or a sticky note, in the font it asks for, or Inter Tight where this computer lacks it. */
function words(fields: ItemFields, size: { width: number; height?: number }, fill: string, padding: number): ReactNode {
  return (
    <Text
      text={fields.text}
      width={size.width}
      {...(size.height === undefined ? {} : { height: size.height })}
      padding={padding}
      fontFamily={cssFamily(fields.fontFamily, fontsStore.getState(), { weight: fields.fontWeight, italic: fields.fontItalic })}
      fontStyle={fontStyleOf(fields.fontWeight, fields.fontItalic)}
      fontSize={fields.fontSize}
      lineHeight={LINE_HEIGHT}
      align={fields.align}
      fill={fill}
      listening={false}
    />
  );
}

const MONO = '"JetBrains Mono", monospace';

/** A picture: the stored picture in its box, the thumbnail or the full size by how large it is drawn. */
function picture(id: string, card: CardInfo | null, context: DrawContext): ReactNode {
  return <PictureNode id={id} sha256={card?.sha256 ?? null} width={context.width} height={context.height} zoom={context.zoom} inView={context.inView} colours={context.colours} />;
}

/** A video card: its poster, with the file's name and length in a bar along the foot, or the missing flag in it. */
function videoCard(id: string, card: CardInfo | null, context: DrawContext): ReactNode {
  const { width, height, colours } = context;
  const bar = Math.min(40, Math.max(22, height / 4));
  const missing = card?.missing === true;
  return (
    <>
      <PictureNode id={id} sha256={card?.sha256 ?? null} width={width} height={height} zoom={context.print === true ? context.zoom : 0} inView colours={colours} />
      <Rect y={height - bar} width={width} height={bar} fill={missing ? BOARD_WARNING : BOARD_INK} listening={false} />
      <Group clipX={0} clipY={height - bar} clipWidth={width} clipHeight={bar}>
        <Text
          x={8}
          y={height - bar}
          width={Math.max(0, width - 16)}
          height={bar}
          verticalAlign="middle"
          text={missing ? `${t('moodboard.videoMissing')}  ${card.name}` : (card?.name ?? '')}
          fontFamily={MONO}
          fontSize={Math.min(14, bar * 0.45)}
          fontStyle="bold"
          wrap="none"
          ellipsis
          fill={BOARD_PAPER}
          listening={false}
        />
        {!missing && card?.duration && (
          <Text x={0} y={height - bar} width={width - 8} height={bar} verticalAlign="middle" align="right" text={card.duration} fontFamily={MONO} fontSize={Math.min(14, bar * 0.45)} fill={BOARD_PAPER} listening={false} />
        )}
      </Group>
      <Rect width={width} height={height} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
    </>
  );
}

/** A link card: what it is, its title (or the host and path) and its address. Nothing is fetched to fill it. */
function linkCard(fields: ItemFields, { width, height, colours }: DrawContext): ReactNode {
  const label = linkLabel(fields.url, fields.title);
  const family = cssFamily(DEFAULT_FONT_FAMILY, fontsStore.getState(), { weight: 700, italic: false });
  return (
    <>
      {/* The address rides on the card's box, for a PDF export to make it a link (5.6a). */}
      <Rect width={width} height={height} fill={BOARD_PAPER} stroke={colours.ink} strokeWidth={STROKE} strokeScaleEnabled={false} name="sb-link" {...{ sbUrl: fields.url }} />
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        <Text x={12} y={10} width={width - 24} text={t('moodboard.link.label')} fontFamily={MONO} fontSize={10} letterSpacing={1} fill={colours.ink} listening={false} />
        <Text x={12} y={26} width={width - 24} height={Math.max(0, height - 52)} text={label} fontFamily={family} fontStyle="bold" fontSize={18} lineHeight={1.2} fill={colours.ink} ellipsis listening={false} />
        <Text x={12} y={height - 24} width={width - 24} height={16} text={fields.url} fontFamily={MONO} fontSize={11} wrap="none" ellipsis fill={colours.ink} listening={false} />
      </Group>
    </>
  );
}

/** A section: a tinted box with the board's ink outline, drawn under everything else on the board. */
function sectionBox(fields: ItemFields, { width, height, colours }: DrawContext): ReactNode {
  return <Rect width={width} height={height} fill={fields.color ?? SECTION_COLOURS[0]} stroke={colours.ink} strokeWidth={STROKE} strokeScaleEnabled={false} />;
}

/** A page: its own background (white unless changed) with the board's ink outline. */
function pageBox(fields: ItemFields, { width, height, colours, print }: DrawContext): ReactNode {
  // An export prints the page as the paper it is: its background, without the outline the screen draws round it.
  if (print === true) return <Rect width={width} height={height} fill={fields.background} />;
  return <Rect width={width} height={height} fill={fields.background} stroke={colours.ink} strokeWidth={STROKE} strokeScaleEnabled={false} />;
}

/** The size a field card's words are set at to fit its box: the size set, or smaller down to a floor of 60% of it, and whether they still overflow. */
const FIT_FLOOR = 0.6;
const fitted = new Map<string, { size: number; over: boolean }>();
export function fitFieldText(fields: ItemFields, text: string, width: number, height: number): { size: number; over: boolean } {
  // Measured once per text, face, size and box: a card is drawn again on every frame of a pan or zoom.
  const key = JSON.stringify([text, fields.fontFamily, fields.fontWeight, fields.fontItalic, fields.fontSize, fields.align, width, height]);
  const known = fitted.get(key);
  if (known) return known;
  const result = measureFit(fields, text, width, height);
  if (fitted.size >= 500) fitted.clear();
  fitted.set(key, result);
  return result;
}

function measureFit(fields: ItemFields, text: string, width: number, height: number): { size: number; over: boolean } {
  const floor = Math.max(4, fields.fontSize * FIT_FLOOR);
  let size = fields.fontSize;
  for (let guard = 0; guard < 12; guard += 1) {
    const needed = measureText({ text, fontFamily: fields.fontFamily, fontWeight: fields.fontWeight, fontItalic: fields.fontItalic, fontSize: size, align: fields.align, width });
    if (needed <= height) return { size, over: false };
    if (size <= floor) return { size: floor, over: true };
    size = Math.max(floor, size * 0.92);
  }
  return { size: floor, over: true };
}

/**
 * A field card (5.5): the project's words in the text style it was given. With nothing to show it draws the field's name in
 * muted ink on screen and nothing in a presentation. A dashed outline on screen marks the box, as an empty text box has.
 */
function fieldCard(fields: ItemFields, value: FieldValue | null, { width, height, colours, present }: DrawContext): ReactNode {
  const text = value?.text ?? '';
  const empty = text === '';
  if (empty && present === true) return null;
  const label = fields.field === '' ? '' : DECK_FIELD_LABEL[fields.field];
  // Long lists shrink to fit their box, down to 60% of the size set; past that, a mark on screen says there is more.
  const fit = empty ? { size: fields.fontSize, over: false } : fitFieldText(fields, text, width, height);
  return (
    <>
      {present !== true && <Rect width={width} height={height} stroke={colours.ink} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} listening={false} />}
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        {words({ ...fields, fontSize: fit.size, text: empty ? label : text }, { width }, empty ? BOARD_MUTED : (fields.color ?? colours.ink), 0)}
      </Group>
      {fit.over && present !== true && (
        <Text x={width - 28} y={height - 22} width={26} height={20} align="center" text="..." fontFamily={MONO} fontStyle="bold" fontSize={14} fill={BOARD_INK} listening={false} />
      )}
    </>
  );
}

/** A section's (or a page's) name above its top left corner, in Inter Tight bold; "Section" when it has none. */
function sectionName(fields: ItemFields, width: number, colours: DrawContext['colours'], pageNumber = 0): ReactNode {
  return (
    <Text
      y={-SECTION_TAB_HEIGHT}
      width={width}
      height={SECTION_TAB_HEIGHT}
      verticalAlign="middle"
      paddingLeft={4}
      text={fields.kind === 'page' ? pageTitle(pageNumber, fields.name) : sectionTitle(fields.name)}
      fontFamily={cssFamily(DEFAULT_FONT_FAMILY, fontsStore.getState(), { weight: 700, italic: false })}
      fontStyle="bold"
      fontSize={SECTION_NAME_SIZE}
      wrap="none"
      ellipsis
      fill={colours.ink}
      listening={false}
    />
  );
}

/**
 * Gives each item its drawing. The item being edited in place is drawn without its text: the editor over it shows it.
 * The fonts version keys the text, so it is drawn again once a font it waited for has loaded.
 */
export interface DrawExtras {
  /** A page's number in the deck's order (5.5), for the tab above its corner. */
  pageNumbers?: ReadonlyMap<string, number>;
  /** What a field card shows now. */
  fieldOf?: (id: string) => FieldValue | null;
  /** Drawn for a presentation. */
  present?: boolean;
}

export function withDrawing(
  items: readonly CanvasItem[],
  fieldsOf: (id: string) => ItemFields | null,
  cardOf: (id: string) => CardInfo | null,
  liveOf: (id: string) => LiveCardData | null,
  editingId: string | null,
  fontsVersion: number,
  extras: DrawExtras = {},
): CanvasItem[] {
  return items.map((item) => {
    const fields = fieldsOf(item.id);
    if (!fields) return item;
    const hidden = item.id === editingId;
    return {
      ...item,
      // A section's name is drawn by the canvas beside it (outside its box, so the handles don't take it in); not while it is typed.
      ...(isFrameKind(fields.kind) && item.section
        ? { section: { ...item.section, drawTab: ({ colours }: { colours: DrawContext['colours'] }) => <Group key={fontsVersion}>{!hidden && sectionName(fields, item.section?.tab.width ?? item.width, colours, extras.pageNumbers?.get(item.id) ?? 0)}</Group> } }
        : {}),
      draw: (context) => {
        if (fields.kind === 'section') return sectionBox(fields, context);
        if (fields.kind === 'page') return pageBox(fields, context);
        if (fields.kind === 'field_card') return <Group key={fontsVersion}>{fieldCard(fields, extras.fieldOf?.(item.id) ?? null, { ...context, ...(extras.present ? { present: true } : {}) })}</Group>;
        if (fields.kind === 'text') {
          return (
            <Group key={fontsVersion}>
              {fields.text === '' && context.present !== true && <Rect width={context.width} height={context.height} stroke={context.colours.ink} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />}
              {!hidden && words(fields, { width: context.width }, fields.color ?? context.colours.ink, 0)}
            </Group>
          );
        }
        if (fields.kind === 'sticky') {
          return (
            <Group key={fontsVersion}>
              <Rect width={context.width} height={context.height} fill={fields.color ?? STICKY_COLOURS[0]} stroke={context.colours.ink} strokeWidth={STROKE} strokeScaleEnabled={false} />
              <Group clipX={0} clipY={0} clipWidth={context.width} clipHeight={context.height}>
                {!hidden && words(fields, { width: context.width, height: context.height }, STICKY_INK, STICKY_PADDING)}
              </Group>
            </Group>
          );
        }
        if (isLiveKind(fields.kind)) {
          const live = liveOf(item.id);
          return <Group key={fontsVersion}>{live && drawLive(item.id, live, context)}</Group>;
        }
        if (fields.kind === 'picture') return picture(item.id, cardOf(item.id), context);
        if (fields.kind === 'video') return <Group key={fontsVersion}>{videoCard(item.id, cardOf(item.id), context)}</Group>;
        if (fields.kind === 'link') return <Group key={fontsVersion}>{linkCard(fields, context)}</Group>;
        return shape(fields, context);
      },
    };
  });
}
