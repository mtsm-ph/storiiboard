import { COMPOSE_SCALE, MAP_HEIGHT, MAP_WIDTH, mapTilesFor, POINTS_PER_PIXEL, tileKey } from './sheetMap';
import { makeCanvas, canvasBlob } from '../../core/media/canvas';
import { TILE_SIZE, type LatLon } from '../../core/model/mercator';

// The PDF's map picture (4.10): the frame's tiles drawn onto one canvas at twice their size, with the sub-tile offsets that
// centre the place, and encoded as one JPEG. The browser decodes whatever the tile server sends (PNG, JPEG, WebP), the
// squares meet without seams, and the PDF holds one picture per map, not up to six whole tiles. It needs a canvas, so it
// lives apart from callSheetPdf (which stays pure and is given the bytes) and is tested in the browser.

const QUALITY = 0.85;

/** The tile's type from its first bytes (PNG, JPEG or WebP), so WebKit need not sniff it; empty when unknown. */
function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

/** The frame's picture as JPEG bytes, or null when no tile could be drawn (none came, or none could be decoded). */
export async function composeMap(place: LatLon, tiles: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array | null> {
  const scale = COMPOSE_SCALE;
  const width = Math.round((MAP_WIDTH / POINTS_PER_PIXEL) * scale);
  const height = Math.round((MAP_HEIGHT / POINTS_PER_PIXEL) * scale);
  // makeCanvas falls back to a <canvas> where there is no OffscreenCanvas (macOS 13.0 to 13.2).
  const { canvas, ctx: context } = makeCanvas(width, height);
  if (!context) return null;
  // A tile that is missing leaves paper white (a JPEG has no transparency).
  context.fillStyle = 'white';
  context.fillRect(0, 0, width, height);
  let drawn = 0;
  for (const tile of mapTilesFor(place)) {
    const bytes = tiles.get(tileKey(tile));
    if (!bytes) continue;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: imageType(bytes) }));
    } catch {
      continue;
    }
    // Edges rounded outward, so two neighbours overlap by a pixel and never leave a seam.
    const left = Math.floor(tile.left * scale);
    const top = Math.floor(tile.top * scale);
    context.drawImage(bitmap, left, top, Math.ceil((tile.left + TILE_SIZE) * scale) - left, Math.ceil((tile.top + TILE_SIZE) * scale) - top);
    bitmap.close();
    drawn += 1;
  }
  if (drawn === 0) return null;
  const blob = await canvasBlob(canvas, 'image/jpeg', QUALITY);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
