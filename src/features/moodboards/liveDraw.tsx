import type { ReactNode } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import { t, tn } from '../../core/i18n';
import type { ShotStatus } from '../../core/model/shotStatus';
import type { DrawContext } from '../../ui/canvas/types';
import { arrowHead, pressureOutline, type Stroke } from '../storyboard/sketch/strokes';
import { cssFamily, fontsStore } from './fonts';
import { BOARD_INK, BOARD_MUTED, BOARD_PAPER, BOARD_RAISED, DEFAULT_FONT_FAMILY } from './items';
import {
  BRAND_FONT_LINE,
  BRAND_LOGO_HEIGHT,
  BRAND_NAME_HEIGHT,
  designSize,
  drawScale,
  letterbox,
  PICTURE_ASPECT,
  PALETTE_CELL,
  PALETTE_COLUMNS,
  PALETTE_HEADER,
  SCENE_GAP,
  SCENE_HEADER,
  SHOT_FOOTER,
  stateWords,
  type BrandCardData,
  type LiveCardData,
  type PaletteCardData,
  type SceneCardData,
  type ShotCardData,
} from './liveCards';
import { PictureNode } from './PictureNode';

// How the live cards are drawn (5.4). Each is laid out on a fixed design (liveCards.ts, designSize) and scaled to the card's
// box, so resizing a card scales everything in it. Colours are the board's own, fixed in light and dark. A card whose record
// is in the Trash is drawn dimmed with "In the Trash"; one whose record is gone says so. Neither is an error.

const MONO = '"JetBrains Mono", monospace';
const MUTED = BOARD_MUTED;
const STROKE = 1.5;

const sans = (bold = true) => cssFamily(DEFAULT_FONT_FAMILY, fontsStore.getState(), { weight: bold ? 700 : 400, italic: false });

/** The frame's status as a shape, not colour: Have ■, Need to shoot □, Source ◩ (CLAUDE.md, Design). */
function statusShape(status: ShotStatus, x: number, y: number, size: number): ReactNode {
  if (status === 'have') return <Rect x={x} y={y} width={size} height={size} fill={BOARD_INK} listening={false} />;
  return (
    <>
      <Rect x={x} y={y} width={size} height={size} stroke={BOARD_INK} strokeWidth={2} listening={false} />
      {status === 'source' && <Line points={[x, y, x + size, y, x, y + size]} closed fill={BOARD_INK} listening={false} />}
    </>
  );
}

/** A frame's sketch over its picture, from the same strokes the storyboard draws (pressure lines as plain outlines). */
function sketch(strokes: readonly Stroke[], width: number, height: number): ReactNode {
  return strokes.map((stroke) => {
    const common = { stroke: BOARD_INK, strokeWidth: Math.max(stroke.width * height, 1.5), lineCap: 'round' as const, lineJoin: 'round' as const, listening: false };
    const p = stroke.points.map((n, i) => (i % 2 === 0 ? n * width : n * height));
    if (stroke.tool === 'box') {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
      return <Rect key={stroke.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} {...common} />;
    }
    if (stroke.tool === 'arrow') {
      return (
        <Group key={stroke.id}>
          <Line points={p.slice(0, 4)} {...common} />
          <Line points={arrowHead(stroke.points, width, height, stroke.width)} closed fill={BOARD_INK} listening={false} />
        </Group>
      );
    }
    if (stroke.pressures) return <Line key={stroke.id} points={pressureOutline(stroke.points, stroke.pressures, width, height, stroke.width, 1.5)} closed fill={BOARD_INK} listening={false} />;
    return <Line key={stroke.id} points={p} {...common} />;
  });
}

/** What replaces a card whose record is gone or in the Trash: a dashed box and the words. */
function missing(kind: LiveCardData['kind'], state: 'trash' | 'gone', width: number, height: number): ReactNode {
  return (
    <>
      <Rect width={width} height={height} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} dash={state === 'gone' ? [8, 6] : []} strokeScaleEnabled={false} listening={false} />
      <Text width={width} height={height} align="center" verticalAlign="middle" text={stateWords(kind, state)} fontFamily={MONO} fontStyle="bold" fontSize={Math.max(12, Math.min(22, width / 12))} fill={BOARD_INK} listening={false} />
    </>
  );
}

function shotCard(id: string, data: ShotCardData, { zoom, inView, colours }: DrawContext, k: number, design: { width: number; height: number }): ReactNode {
  const picHeight = design.height - SHOT_FOOTER;
  const frameBox = letterbox(data.aspect, design.width, picHeight);
  const spec = [data.size, data.lens, data.move].filter((s) => s !== '').join(' · ');
  const body = (
    <>
      <Rect width={design.width} height={design.height} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} strokeScaleEnabled={false} />
      {/* The picture area is always 16:9; the frame is letterboxed inside it, whatever the project's shape. */}
      <Rect width={design.width} height={picHeight} fill={BOARD_RAISED} listening={false} />
      <Group x={frameBox.x} y={frameBox.y}>
        {data.sha256 && (
          <PictureNode id={id} sha256={data.sha256} width={frameBox.width} height={frameBox.height} zoom={zoom * k} inView={inView} colours={colours} fit={{ kind: 'cover', crop: data.crop }} />
        )}
        {data.sha256 === null && <Rect width={frameBox.width} height={frameBox.height} fill={BOARD_PAPER} listening={false} />}
        {sketch(data.strokes, frameBox.width, frameBox.height)}
      </Group>
      <Rect y={picHeight} width={design.width} height={1.5} fill={BOARD_INK} listening={false} />
      <Text x={12} y={picHeight + 8} width={design.width - 52} text={data.number === '' ? '—' : data.number} fontFamily={MONO} fontStyle="bold" fontSize={24} wrap="none" ellipsis fill={BOARD_INK} listening={false} />
      <Text x={12} y={picHeight + 38} width={design.width - 24} text={spec} fontFamily={MONO} fontSize={14} wrap="none" ellipsis fill={MUTED} listening={false} />
      {statusShape(data.status, design.width - 12 - 18, picHeight + 14, 18)}
    </>
  );
  return <Group scaleX={k} scaleY={k}>{body}</Group>;
}

function sceneCard(id: string, data: SceneCardData, { zoom, inView, colours }: DrawContext, k: number, design: { width: number; height: number }): ReactNode {
  const cell = (design.width - SCENE_GAP * 5) / 4;
  const thumbHeight = Math.round(cell / PICTURE_ASPECT);
  const thumbBox = letterbox(data.aspect, cell, thumbHeight);
  return (
    <Group scaleX={k} scaleY={k}>
      <Rect width={design.width} height={design.height} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} strokeScaleEnabled={false} />
      <Text x={SCENE_GAP} y={10} text={data.label} fontFamily={MONO} fontStyle="bold" fontSize={16} fill={BOARD_INK} listening={false} />
      <Text x={SCENE_GAP} y={30} width={design.width - SCENE_GAP * 2} text={data.heading} fontFamily={sans()} fontStyle="bold" fontSize={20} wrap="none" ellipsis fill={BOARD_INK} listening={false} />
      <Text x={SCENE_GAP} y={54} width={design.width - SCENE_GAP * 2} text={tn('count.frames', data.frames)} fontFamily={MONO} fontSize={13} fill={MUTED} listening={false} />
      {data.first.map((frame, i) => {
        const x = SCENE_GAP + i * (cell + SCENE_GAP);
        return (
          <Group key={frame.id} x={x} y={SCENE_HEADER}>
            <Rect width={cell} height={thumbHeight} fill={BOARD_RAISED} listening={false} />
            {frame.sha256 && (
              <Group x={thumbBox.x} y={thumbBox.y}>
                <PictureNode id={`${id}:${String(i)}`} sha256={frame.sha256} width={thumbBox.width} height={thumbBox.height} zoom={zoom * k} inView={inView} colours={colours} fit={{ kind: 'cover', crop: frame.crop }} />
              </Group>
            )}
            <Rect width={cell} height={thumbHeight} stroke={BOARD_INK} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
            <Text x={4} y={thumbHeight - 18} text={frame.number} fontFamily={MONO} fontStyle="bold" fontSize={12} fill={BOARD_INK} listening={false} />
          </Group>
        );
      })}
    </Group>
  );
}

/** A grid of colours with their hex under each, four to a row. */
function swatches(colors: readonly string[], x: number, y: number): ReactNode {
  // Four to a row, 84 apart, each swatch 76 wide.
  const column = 84;
  return colors.map((hex, i) => {
    const cx = x + (i % PALETTE_COLUMNS) * column;
    const cy = y + Math.floor(i / PALETTE_COLUMNS) * PALETTE_CELL;
    return (
      <Group key={hex} x={cx} y={cy}>
        <Rect width={column - 8} height={52} fill={hex} stroke={BOARD_INK} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
        <Text y={56} width={column - 8} text={hex} fontFamily={MONO} fontSize={12} fill={BOARD_INK} listening={false} />
      </Group>
    );
  });
}

function paletteCard(data: PaletteCardData, k: number, design: { width: number; height: number }, present: boolean): ReactNode {
  return (
    <Group scaleX={k} scaleY={k}>
      <Rect width={design.width} height={design.height} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} strokeScaleEnabled={false} />
      <Text x={12} y={10} text={data.label} fontFamily={MONO} fontStyle="bold" fontSize={14} fill={BOARD_INK} listening={false} />
      <Text x={12} y={28} width={design.width - 24} text={data.heading} fontFamily={sans()} fontStyle="bold" fontSize={18} wrap="none" ellipsis fill={BOARD_INK} listening={false} />
      {data.colors.length === 0 ? (
        // The hint is for the person editing; a presentation draws none.
        present ? null : <Text x={12} y={PALETTE_HEADER} width={design.width - 24} text={t('moodboard.live.noPalette')} fontFamily={sans(false)} fontSize={15} lineHeight={1.3} fill={BOARD_INK} listening={false} />
      ) : (
        swatches(data.colors, 12, PALETTE_HEADER)
      )}
    </Group>
  );
}

function brandCard(id: string, data: BrandCardData, { zoom, inView, colours, present }: DrawContext, k: number, design: { width: number; height: number }): ReactNode {
  if (!data.company) {
    if (present === true) return null;
    return (
      <Group scaleX={k} scaleY={k}>
        <Rect width={design.width} height={design.height} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} dash={[8, 6]} strokeScaleEnabled={false} />
        <Text x={12} y={12} width={design.width - 24} text={t('moodboard.live.brandNone')} fontFamily={sans(false)} fontSize={16} lineHeight={1.3} fill={BOARD_INK} listening={false} />
      </Group>
    );
  }
  let y = 12;
  const logoY = y;
  y += BRAND_LOGO_HEIGHT + 8;
  const nameY = y;
  y += BRAND_NAME_HEIGHT;
  const colorsY = y;
  const rows = Math.ceil(data.colors.length / PALETTE_COLUMNS);
  y += rows > 0 ? rows * PALETTE_CELL + 8 : 0;
  const fontsY = y;
  return (
    <Group scaleX={k} scaleY={k}>
      <Rect width={design.width} height={design.height} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} strokeScaleEnabled={false} />
      <Group x={12} y={logoY}>
        {data.logoSha256 ? (
          <PictureNode id={id} sha256={data.logoSha256} width={design.width - 24} height={BRAND_LOGO_HEIGHT} zoom={zoom * k} inView={inView} colours={colours} fit={{ kind: 'contain' }} />
        ) : present === true ? null : (
          <Text width={design.width - 24} height={BRAND_LOGO_HEIGHT} verticalAlign="middle" text={t('moodboard.live.brandNoLogo')} fontFamily={MONO} fontSize={12} fill={MUTED} listening={false} />
        )}
      </Group>
      <Text x={12} y={nameY} width={design.width - 24} text={data.company.name || t('company.unnamed')} fontFamily={sans()} fontStyle="bold" fontSize={22} wrap="none" ellipsis fill={BOARD_INK} listening={false} />
      {swatches(data.colors, 12, colorsY)}
      {data.fonts.map((family, i) => (
        // Each set in its own face; a family this computer lacks is drawn in Inter Tight (fonts.ts).
        <Text key={family} x={12} y={fontsY + i * BRAND_FONT_LINE} width={design.width - 24} text={family} fontFamily={cssFamily(family, fontsStore.getState(), { weight: 400, italic: false })} fontSize={24} wrap="none" ellipsis fill={BOARD_INK} listening={false} />
      ))}
    </Group>
  );
}

/** A live card in its box: the card as drawn from `data`, or the words that stand in for a record that is gone or trashed. */
export function drawLive(id: string, data: LiveCardData, context: DrawContext): ReactNode {
  const design = designSize(data.kind);
  const k = drawScale(data.kind, context.width, context.height);
  if (data.kind === 'brand_card') return brandCard(id, data, context, k, design);
  // A presentation draws no editing hint: a card whose record is in the Trash or gone is left out.
  if (context.present === true && data.state !== 'live') return null;
  if (data.state === 'gone') return missing(data.kind, 'gone', context.width, context.height);
  const body =
    data.kind === 'shot_card' ? shotCard(id, data, context, k, design) : data.kind === 'scene_card' ? sceneCard(id, data, context, k, design) : paletteCard(data, k, design, context.present === true);
  if (data.state === 'live') return body;
  // In the Trash: dimmed, and says so; it stays on the board.
  return (
    <>
      <Group opacity={0.4}>{body}</Group>
      <Rect y={context.height / 2 - 18} width={context.width} height={36} fill={BOARD_PAPER} stroke={BOARD_INK} strokeWidth={STROKE} strokeScaleEnabled={false} listening={false} />
      <Text y={context.height / 2 - 18} width={context.width} height={36} align="center" verticalAlign="middle" text={stateWords(data.kind, 'trash')} fontFamily={MONO} fontStyle="bold" fontSize={16} fill={BOARD_INK} listening={false} />
    </>
  );
}
