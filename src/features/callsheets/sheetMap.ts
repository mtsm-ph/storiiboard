import { START_ZOOM, tilesInView, TILE_SIZE, type LatLon, type TileInView } from '../../core/model/mercator';

// The map on the call sheet's PDF (4.10): where its tiles are and what it is given to draw. Pure, so the layout can be
// tested without a PDF or a network.

/** The map's frame on paper: about 60 mm by 40 mm. */
export const MAP_WIDTH = 60 * (72 / 25.4);
export const MAP_HEIGHT = 40 * (72 / 25.4);
/** Zoom 16 (a street block across the frame), the same as the sheet's map on screen. */
export const MAP_ZOOM = START_ZOOM;
/** Points of paper per tile pixel: a 256 px tile is 128 pt (45 mm), so the frame holds at most 3 by 2 tiles. */
export const POINTS_PER_PIXEL = 0.5;
/** A tile's side on paper. */
export const TILE_POINTS = TILE_SIZE * POINTS_PER_PIXEL;

/** The tiles the frame needs for a place at its centre: only those the frame shows, none ahead (OpenStreetMap's policy). */
export const mapTilesFor = (place: LatLon): TileInView[] => tilesInView(place, MAP_ZOOM, MAP_WIDTH / POINTS_PER_PIXEL, MAP_HEIGHT / POINTS_PER_PIXEL);

/** The picture is made at this many pixels per tile pixel (about 680 x 454 for the frame: ~290 dpi on paper). */
export const COMPOSE_SCALE = 2;

export const tileKey = (tile: { z: number; x: number; y: number }): string => `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;

/** What a location's map is given to draw, by what could be had. */
export type PdfMap =
  /** The frame's picture, composed from the tiles that came and encoded as one JPEG (composeMap.ts), with its credit. */
  | { kind: 'image'; jpeg: Uint8Array; credit: string }
  /** The browser build, which has no tiles: the grid the screen's map draws. */
  | { kind: 'grid'; credit: string }
  /** No tile could be had (offline, switched off, refused): an empty frame and this line, and no credit. */
  | { kind: 'none'; why: string };

/** A map as gathered, with the place that centred it, so it is used only while the location's place is still that one. */
export type GatheredMap = PdfMap & { at: { latitude: number; longitude: number } };
