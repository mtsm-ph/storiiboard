// Web Mercator maths for the Locations tile's map (4.9): the standard "slippy map" tiles OpenStreetMap serves
// (256 px squares, 2^z of them across at zoom z, zoom 0 to 19). Pure functions, no drawing and no network; the map
// (src/features/locations/LocationMap.tsx) and its tests use them.

export const TILE_SIZE = 256;
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 19;
/** The map is drawn at this zoom first: about a street block across 360 px. */
export const START_ZOOM = 16;
/** The poles the projection can reach (where the world is a square). */
export const MAX_LATITUDE = 85.0511287798066;

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** A point on the whole world's picture at one zoom, in pixels from its top left corner. */
export interface WorldPoint {
  x: number;
  y: number;
}

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));

/** The world's width in pixels at a zoom. */
export const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A longitude brought into -180 to 180 (the antimeridian wraps: 190 is -170). */
export function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** Where a place is on the world's picture at `zoom`. A latitude past the poles' limit is held at it. */
export function toWorld({ latitude, longitude }: LatLon, zoom: number): WorldPoint {
  const size = worldSize(zoom);
  const lat = (clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;
  return {
    x: ((wrapLongitude(longitude) + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

/** The place at a point of the world's picture; x past either edge wraps round the world, y is held on it. */
export function fromWorld({ x, y }: WorldPoint, zoom: number): LatLon {
  const size = worldSize(zoom);
  const wrapped = ((x % size) + size) % size;
  const n = Math.PI * (1 - (2 * clamp(y, 0, size)) / size);
  return {
    latitude: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    longitude: (wrapped / size) * 360 - 180,
  };
}

/** The tile a place is in at `zoom`. */
export function tileOf(place: LatLon, zoom: number): { z: number; x: number; y: number } {
  const world = toWorld(place, zoom);
  const last = 2 ** zoom - 1;
  return { z: zoom, x: clamp(Math.floor(world.x / TILE_SIZE), 0, last), y: clamp(Math.floor(world.y / TILE_SIZE), 0, last) };
}

/** A tile to draw: which one (x already wrapped round the world) and where its top left corner is on screen. */
export interface TileInView {
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/**
 * The tiles that cover a `width` by `height` view centred on `center` at `zoom`, and only those: no neighbours beyond
 * the edge (OpenStreetMap's policy asks for the tiles being viewed and nothing ahead). Rows above or below the world
 * are left out; columns past the antimeridian wrap to the other side, so the map is continuous there.
 */
export function tilesInView(center: LatLon, zoom: number, width: number, height: number): TileInView[] {
  const middle = toWorld(center, zoom);
  const originX = middle.x - width / 2;
  const originY = middle.y - height / 2;
  const count = 2 ** zoom;
  const tiles: TileInView[] = [];
  const firstColumn = Math.floor(originX / TILE_SIZE);
  const lastColumn = Math.floor((originX + width - 1e-9) / TILE_SIZE);
  const firstRow = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastRow = Math.min(count - 1, Math.floor((originY + height - 1e-9) / TILE_SIZE));
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      tiles.push({
        z: zoom,
        x: ((column % count) + count) % count,
        y: row,
        left: column * TILE_SIZE - originX,
        top: row * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/** Where a place is on screen in a view centred on `center` (the view's top left is 0, 0). */
export function toScreen(place: LatLon, center: LatLon, zoom: number, width: number, height: number): WorldPoint {
  const point = toWorld(place, zoom);
  const middle = toWorld(center, zoom);
  const size = worldSize(zoom);
  // Across the antimeridian the shorter way round, so a pin just past it isn't a world away.
  let dx = point.x - middle.x;
  if (dx > size / 2) dx -= size;
  else if (dx < -size / 2) dx += size;
  return { x: width / 2 + dx, y: height / 2 + (point.y - middle.y) };
}

/** The place at a screen point in a view centred on `center`. */
export function fromScreen(point: WorldPoint, center: LatLon, zoom: number, width: number, height: number): LatLon {
  const middle = toWorld(center, zoom);
  return fromWorld({ x: middle.x + point.x - width / 2, y: middle.y + point.y - height / 2 }, zoom);
}

/** The view's centre moved by `dx`, `dy` screen pixels (dragging the map the other way), kept on the world. */
export function panned(center: LatLon, zoom: number, dx: number, dy: number): LatLon {
  const middle = toWorld(center, zoom);
  return fromWorld({ x: middle.x + dx, y: middle.y + dy }, zoom);
}

/**
 * The view's centre after zooming to `next` with the screen point `anchor` staying where it is (the wheel zooms round
 * the pointer; the buttons round the middle). The zoom is held in range.
 */
export function zoomedAround(center: LatLon, zoom: number, next: number, anchor: WorldPoint, width: number, height: number): { center: LatLon; zoom: number } {
  const target = clampZoom(next);
  if (target === zoom) return { center, zoom };
  const fixed = fromScreen(anchor, center, zoom, width, height);
  const fixedAt = toWorld(fixed, target);
  const wrapped = fromWorld({ x: fixedAt.x - anchor.x + width / 2, y: fixedAt.y - anchor.y + height / 2 }, target);
  return { center: wrapped, zoom: target };
}

/** Metres on the ground that one screen pixel covers at a latitude and zoom (for a step that feels the same everywhere). */
export function metresPerPixel(latitude: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180)) / worldSize(zoom);
}
