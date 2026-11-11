import type { ReactNode } from 'react';
import { Ellipse, Group, Line, Rect, Text } from 'react-konva';
import type { CanvasItem, DrawContext } from '../../ui/canvas/types';
import { cssFamily, fontsStore } from './fonts';
import { LINE_HEIGHT, STICKY_COLOURS, STICKY_INK, STICKY_PADDING, type ItemFields } from './items';
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

/**
 * Gives each item its drawing. The item being edited in place is drawn without its text: the editor over it shows it.
 * The fonts version keys the text, so it is drawn again once a font it waited for has loaded.
 */
export function withDrawing(items: readonly CanvasItem[], fieldsOf: (id: string) => ItemFields | null, editingId: string | null, fontsVersion: number): CanvasItem[] {
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
        return shape(fields, context);
      },
    };
  });
}
