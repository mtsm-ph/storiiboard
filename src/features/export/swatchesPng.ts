import { canvasBlob, makeCanvas, type Canvas2D } from '../../core/media/canvas';
import { t, tn } from '../../core/i18n';
import type { ExportFormat, ExportResult } from './registry';
import { swatchFileName, swatchSet } from './swatchSet';

// Swatches as a PNG strip (5.6b): one row of equal swatches in order, each with its hex below in JetBrains Mono, the scene's heading
// or the company's name above, on paper with ink text. Drawn with the canvas, which is sRGB.

export const STRIP_WIDTH = 2400;
const MARGIN = 80;
const HEADING_HEIGHT = 160;
const SWATCH_HEIGHT = 480;
const HEX_HEIGHT = 120;
/** The brand's paper and ink: fixed, like a board's, since the file is read away from the app and its theme. */
const PAPER = '#EEE9DF';
const INK = '#16150F';
const HEADING_FONT = (size: number) => `700 ${String(size)}px "Inter Tight", Arial, sans-serif`;
const HEX_FONT = (size: number) => `600 ${String(size)}px "JetBrains Mono", Menlo, Consolas, monospace`;

export interface StripLayout {
  width: number;
  height: number;
  /** Each swatch's box, in order. */
  swatches: { x: number; y: number; width: number; height: number }[];
  /** Where the heading and the hexes sit (baselines), and the hex size. */
  headingY: number;
  hexY: number;
  hexSize: number;
}

/** The strip for `count` swatches: 2400 px wide, the swatches equal and side by side between the margins. */
export function stripLayout(count: number): StripLayout {
  const each = Math.floor((STRIP_WIDTH - 2 * MARGIN) / Math.max(1, count));
  const y = MARGIN + HEADING_HEIGHT;
  // "#DF5E27" is seven characters of a face about 0.6 em wide: it fits its swatch with room either side.
  const hexSize = Math.max(16, Math.min(44, Math.floor((each * 0.85) / (7 * 0.6))));
  return {
    width: STRIP_WIDTH,
    height: y + SWATCH_HEIGHT + HEX_HEIGHT + MARGIN,
    swatches: Array.from({ length: Math.max(0, count) }, (_, i) => ({ x: MARGIN + i * each, y, width: each, height: SWATCH_HEIGHT })),
    headingY: MARGIN + HEADING_HEIGHT * 0.7,
    hexY: y + SWATCH_HEIGHT + HEX_HEIGHT * 0.65,
    hexSize,
  };
}

/** Draws the strip: paper, the heading, the swatches, the hex under each. */
export function drawStrip(ctx: Canvas2D, heading: { label: string; title: string }, hexes: readonly string[]): StripLayout {
  const layout = stripLayout(hexes.length);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // The scene's number is a technical value, set in the mono face; the heading after it in the UI face.
  let x = MARGIN;
  if (heading.label !== '') {
    ctx.font = HEX_FONT(72);
    ctx.fillText(heading.label, x, layout.headingY);
    x += ctx.measureText(`${heading.label} `).width;
  }
  ctx.font = HEADING_FONT(72);
  // A long heading is shortened to the strip's width rather than run off it.
  let shown = heading.title;
  while (shown.length > 1 && x + ctx.measureText(shown).width > layout.width - MARGIN) shown = `${shown.slice(0, -2).trimEnd()}…`;
  ctx.fillText(shown, x, layout.headingY);
  hexes.forEach((hex, i) => {
    const box = layout.swatches[i];
    if (!box) return;
    ctx.fillStyle = hex;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    // A thin ink rule around each, so a swatch the colour of the paper still shows.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = INK;
    ctx.font = HEX_FONT(layout.hexSize);
    ctx.textAlign = 'center';
    ctx.fillText(hex, box.x + box.width / 2, layout.hexY);
  });
  return layout;
}

export const swatchesPng: ExportFormat = {
  id: 'swatches-png',
  get label() {
    return t('export.swatches.png.label');
  },
  get description() {
    return t('export.swatches.png.description');
  },
  output: 'file',
  swatches: true,
  name: (title) => swatchFileName(title, 'png'),
  run: async ({ records, projectId, swatches, target, signal }): Promise<ExportResult> => {
    const set = swatches ? swatchSet(records, projectId, swatches) : null;
    if (!set || set.hexes.length === 0) throw new Error(t('export.swatches.none'));
    // The faces are bundled; the canvas draws in them only once they're loaded.
    if (typeof document !== 'undefined') {
      await Promise.all([document.fonts.load(HEX_FONT(40), '#0123456789ABCDEF'), document.fonts.load(HEADING_FONT(72))]).catch(() => undefined);
    }
    signal.throwIfAborted();
    const { width, height } = stripLayout(set.hexes.length);
    const { canvas, ctx } = makeCanvas(width, height, { colorSpace: 'srgb' });
    if (!ctx) throw new Error(t('export.swatches.cantDraw'));
    drawStrip(ctx, set.parts, set.hexes);
    const blob = await canvasBlob(canvas, 'image/png');
    if (!blob) throw new Error(t('export.swatches.cantSave'));
    signal.throwIfAborted();
    await target.write(swatchFileName(set.name, 'png'), new Uint8Array(await blob.arrayBuffer()));
    return { what: tn('count.colors', set.hexes.length) };
  },
};
