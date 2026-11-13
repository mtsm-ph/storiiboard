import type { ReactNode } from 'react';
import { Ellipse, Group, Line, Rect, Text } from 'react-konva';
import { t } from '../../core/i18n';
import type { CanvasItem, DrawContext } from '../../ui/canvas/types';
import type { CardInfo } from './cards';
import { cssFamily, fontsStore } from './fonts';
import { BOARD_INK, BOARD_PAPER, BOARD_WARNING, DEFAULT_FONT_FAMILY, LINE_HEIGHT, STICKY_COLOURS, STICKY_INK, STICKY_PADDING, type ItemFields } from './items';
import { linkLabel } from './links';
import { PictureNode } from './PictureNode';
import { fontStyleOf } from './textFit';

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
      <PictureNode id={id} sha256={card?.sha256 ?? null} width={width} height={height} zoom={0} inView colours={colours} />
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
      <Rect width={width} height={height} fill={BOARD_PAPER} stroke={colours.ink} strokeWidth={STROKE} strokeScaleEnabled={false} />
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        <Text x={12} y={10} width={width - 24} text={t('moodboard.link.label')} fontFamily={MONO} fontSize={10} letterSpacing={1} fill={colours.ink} listening={false} />
        <Text x={12} y={26} width={width - 24} height={Math.max(0, height - 52)} text={label} fontFamily={family} fontStyle="bold" fontSize={18} lineHeight={1.2} fill={colours.ink} ellipsis listening={false} />
        <Text x={12} y={height - 24} width={width - 24} height={16} text={fields.url} fontFamily={MONO} fontSize={11} wrap="none" ellipsis fill={colours.ink} listening={false} />
      </Group>
    </>
  );
}

/**
 * Gives each item its drawing. The item being edited in place is drawn without its text: the editor over it shows it.
 * The fonts version keys the text, so it is drawn again once a font it waited for has loaded.
 */
export function withDrawing(
  items: readonly CanvasItem[],
  fieldsOf: (id: string) => ItemFields | null,
  cardOf: (id: string) => CardInfo | null,
  editingId: string | null,
  fontsVersion: number,
): CanvasItem[] {
  return items.map((item) => {
    const fields = fieldsOf(item.id);
    if (!fields) return item;
    const hidden = item.id === editingId;
    return {
      ...item,
      draw: (context) => {
        if (fields.kind === 'text') {
          return (
            <Group key={fontsVersion}>
              {fields.text === '' && <Rect width={context.width} height={context.height} stroke={context.colours.ink} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />}
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
        if (fields.kind === 'picture') return picture(item.id, cardOf(item.id), context);
        if (fields.kind === 'video') return <Group key={fontsVersion}>{videoCard(item.id, cardOf(item.id), context)}</Group>;
        if (fields.kind === 'link') return <Group key={fontsVersion}>{linkCard(fields, context)}</Group>;
        return shape(fields, context);
      },
    };
  });
}
