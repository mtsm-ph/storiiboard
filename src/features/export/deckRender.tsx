import Konva from 'konva';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { decodedPicture, loadPicture } from '../../core/media/decoded';
import type { ProjectFile } from '../../core/storage/driver';
import { PageStage } from '../../ui/canvas/PageStage';
import { ensureFont, loadSystemFonts } from '../moodboards/fonts';
import { BOARD_COLOURS } from '../moodboards/items';
import type { ScenePage } from '../moodboards/deckPrint';
import type { Matrix, PrintNode } from './deckDisplay';
import { displayOps } from './deckDisplay';
import type { PrintPage } from './deckPdfWriter';

// One deck page drawn by the canvas's own renderer, read-only, as Present draws it (PageStage), in a React root of its own that
// is never put on screen. A PNG is that drawing's pixels; the PDF reads its nodes back (deckDisplay.ts) to draw the same page as
// vector. Everything a page needs is loaded before it is drawn: its fonts, and its pictures at their stored size.

/** The faces the cards themselves draw in, besides those the deck's own text asks for. */
const CARD_FACES = [
  ['Inter Tight', 400],
  ['Inter Tight', 700],
  ['JetBrains Mono', 400],
  ['JetBrains Mono', 700],
] as const;

/** Loads what drawing the page needs: the computer's font list, its fonts and the cards' own, and its pictures at their stored size. */
export async function preparePage(page: ScenePage, file: ProjectFile, pictures: PictureSize = 'stored'): Promise<void> {
  await loadSystemFonts();
  const faces = [...CARD_FACES.map(([family, weight]) => ({ family, weight, italic: false })), ...page.faces];
  await Promise.all(faces.map((face) => ensureFont(face.family, face.weight, face.italic)));
  await document.fonts.ready;
  // A few at a time, so a page of fifty pictures isn't fifty decodes in memory at once; a PDF needs only the small one, which is
  // what the stage draws (the PDF itself reads each picture's file when it is written).
  for (let at = 0; at < page.pictures.length; at += PICTURES_AT_ONCE) {
    await Promise.all(
      page.pictures.slice(at, at + PICTURES_AT_ONCE).flatMap((sha) => (pictures === 'thumbnail' ? [loadPicture(file, sha, 'thumbnail')] : [loadPicture(file, sha, 'thumbnail'), loadPicture(file, sha, 'original')])),
    );
  }
}

/** Which size of a picture a page is drawn with: the project's stored copy (a PNG) or only its small one (a PDF, which reads files itself). */
export type PictureSize = 'stored' | 'thumbnail';
export const PICTURES_AT_ONCE = 4;

/** Whether every picture the page draws is decoded at its stored size now (a cache that let one go would draw the thumbnail). */
export const picturesReady = (page: ScenePage, file: ProjectFile): boolean => page.pictures.every((sha) => decodedPicture(file, sha, 'original') !== undefined);

/** The Konva classes the page's drawing is read back from; a class the canvas draws with that isn't here is left out of the PDF (e2e/deckExport.spec.ts draws every kind and fails on one). */
export const PRINT_KINDS: Readonly<Record<string, PrintNode['kind']>> = {
  Group: 'group',
  Layer: 'group',
  Rect: 'rect',
  Ellipse: 'ellipse',
  Line: 'line',
  Path: 'path',
  Text: 'text',
  Image: 'image',
};

/** A Konva node and everything under it as plain data (deckDisplay.ts's PrintNode); a node of a kind the canvas doesn't draw with is left out. */
export function snapshot(node: Konva.Node): PrintNode | null {
  const kind = PRINT_KINDS[node.getClassName()];
  if (!kind) return null;
  const attrs: Record<string, unknown> = { ...node.getAttrs() };
  if (kind === 'rect' || kind === 'image') {
    attrs.width = node.width();
    attrs.height = node.height();
  }
  const children = node instanceof Konva.Container ? (node.getChildren() as Konva.Node[]).flatMap((child): PrintNode[] => {
        const made = snapshot(child);
        return made ? [made] : [];
      }) : [];
  const out: PrintNode = {
    kind,
    matrix: node.getTransform().getMatrix() as unknown as Matrix,
    opacity: node.opacity(),
    visible: node.visible(),
    attrs,
    children,
  };
  if (node instanceof Konva.Text) {
    // The lines Konva broke the words into, and where its own baseline sits: the PDF keeps both, then sets each line in its font.
    const shift = (node as unknown as { _baselineShift?: number })._baselineShift;
    return { ...out, layout: { lines: (node.textArr as { text: string }[]).map((line) => ({ text: line.text })), width: Number(node.getWidth()), height: Number(node.getHeight()), baselineShift: typeof shift === 'number' ? shift : node.fontSize() * 0.35 } };
  }
  return out;
}

export interface RenderedPage {
  stage: Konva.Stage;
  /** The page's pixels at `pixelRatio` times the page's world size. */
  canvas: (pixelRatio: number) => HTMLCanvasElement;
  /** The page as a PDF page's worth of operations. */
  print: () => PrintPage;
  dispose: () => void;
}

/** The stage's items drawn: PageStage names each one `stage-item`, and the page itself is the first. */
const drawn = (stage: Konva.Stage): number => stage.find('.stage-item').length;

/** Draws a page (its pictures and fonts already loaded) in a React root that is never attached. */
export async function renderPage(page: ScenePage, pictures: PictureSize = 'stored'): Promise<RenderedPage> {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => {
    root.render(<PageStage page={page.page} items={page.items} links={page.links} size={{ width: page.width, height: page.height }} colours={BOARD_COLOURS} print {...(pictures === 'thumbnail' ? { pictureZoom: 0 } : {})} />);
  });
  const find = () => Konva.stages.find((stage) => host.contains(stage.container()));
  // The stage and what is drawn in it come up as the page's effects run: asked for until the count is whole, for a moment at most.
  const wanted = page.items.length + 1;
  for (let tries = 0; tries < 200; tries += 1) {
    const stage = find();
    if (stage && drawn(stage) >= wanted) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  const stage = find();
  if (!stage) {
    flushSync(() => {
      root.unmount();
    });
    throw new Error('This computer can’t draw the deck’s pages for export.');
  }
  return {
    stage,
    canvas: (pixelRatio) => stage.toCanvas({ pixelRatio }),
    print: () => {
      const layer = stage.getLayers()[0];
      const node = layer ? snapshot(layer) : null;
      return { format: page.format, orientation: page.orientation, width: page.width, height: page.height, background: page.background, ops: node ? displayOps(node) : [] };
    },
    dispose: () => {
      flushSync(() => {
        root.unmount();
      });
    },
  };
}
