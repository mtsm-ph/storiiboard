import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fromScreen,
  fromWorld,
  MAX_LATITUDE,
  metresPerPixel,
  panned,
  tileOf,
  tilesInView,
  toScreen,
  toWorld,
  worldSize,
  wrapLongitude,
  zoomedAround,
} from './mercator';

// Web Mercator maths for the map (4.9): the slippy-map tiles OpenStreetMap serves.

const cusco = { latitude: -13.51677, longitude: -71.97875 };

describe('lat/lon and the world picture', () => {
  it('puts the equator and the prime meridian in the middle, whatever the zoom', () => {
    for (const zoom of [0, 5, 16, 19]) {
      const middle = toWorld({ latitude: 0, longitude: 0 }, zoom);
      expect(middle.x).toBeCloseTo(worldSize(zoom) / 2, 6);
      expect(middle.y).toBeCloseTo(worldSize(zoom) / 2, 6);
    }
  });

  it('round-trips places at every zoom', () => {
    for (const zoom of [0, 3, 12, 16, 19]) {
      for (const place of [cusco, { latitude: 40.7128, longitude: -74.006 }, { latitude: -33.8688, longitude: 151.2093 }, { latitude: 64.1466, longitude: -21.9426 }]) {
        const back = fromWorld(toWorld(place, zoom), zoom);
        expect(back.latitude).toBeCloseTo(place.latitude, 7);
        expect(back.longitude).toBeCloseTo(place.longitude, 7);
      }
    }
  });

  it('knows the tile of a place (zoom 16 over New York, from the standard tile formula)', () => {
    expect(tileOf({ latitude: 40.7128, longitude: -74.006 }, 16)).toEqual({ z: 16, x: 19295, y: 24640 });
    expect(tileOf({ latitude: 0, longitude: 0 }, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(tileOf({ latitude: 0, longitude: -180 }, 3)).toEqual({ z: 3, x: 0, y: 4 });
  });

  it('holds the zoom between 0 and 19', () => {
    expect(clampZoom(-3)).toBe(0);
    expect(clampZoom(20)).toBe(19);
    expect(clampZoom(7.6)).toBe(8);
    expect(worldSize(0)).toBe(256);
    expect(worldSize(19)).toBe(256 * 2 ** 19);
  });

  it('holds a latitude past the projection’s poles at its edge and the world’s top and bottom', () => {
    expect(toWorld({ latitude: 90, longitude: 0 }, 4).y).toBeCloseTo(0, 3);
    expect(toWorld({ latitude: -90, longitude: 0 }, 4).y).toBeCloseTo(worldSize(4), 3);
    expect(fromWorld({ x: 0, y: -50 }, 4).latitude).toBeCloseTo(MAX_LATITUDE, 6);
  });
});

describe('the antimeridian', () => {
  it('wraps longitudes into -180 to 180', () => {
    expect(wrapLongitude(190)).toBeCloseTo(-170);
    expect(wrapLongitude(-190)).toBeCloseTo(170);
    expect(wrapLongitude(540)).toBeCloseTo(-180);
    expect(wrapLongitude(0)).toBe(0);
  });

  it('wraps x past either edge round the world', () => {
    const size = worldSize(3);
    expect(fromWorld({ x: size + 10, y: size / 2 }, 3).longitude).toBeCloseTo(fromWorld({ x: 10, y: size / 2 }, 3).longitude, 9);
    expect(fromWorld({ x: -10, y: size / 2 }, 3).longitude).toBeCloseTo(fromWorld({ x: size - 10, y: size / 2 }, 3).longitude, 9);
  });

  it('draws tiles from both sides of it, wrapped, when the view crosses it', () => {
    const tiles = tilesInView({ latitude: 0, longitude: 179.99 }, 2, 512, 256);
    const columns = new Set(tiles.map((tile) => tile.x));
    expect(columns.has(3)).toBe(true);
    expect(columns.has(0)).toBe(true);
    // None is outside the 4 by 4 grid.
    expect(tiles.every((tile) => tile.x >= 0 && tile.x < 4 && tile.y >= 0 && tile.y < 4)).toBe(true);
  });

  it('puts a pin just past it close by, not a world away', () => {
    const at = toScreen({ latitude: 0, longitude: -179.999 }, { latitude: 0, longitude: 179.999 }, 10, 400, 220);
    expect(Math.abs(at.x - 200)).toBeLessThan(20);
  });
});

describe('the tiles in view', () => {
  it('covers the view and only the view', () => {
    const width = 700;
    const height = 220;
    const tiles = tilesInView(cusco, 16, width, height);
    // No tile lies wholly outside the view.
    for (const tile of tiles) {
      expect(tile.left + 256).toBeGreaterThan(0);
      expect(tile.left).toBeLessThan(width);
      expect(tile.top + 256).toBeGreaterThan(0);
      expect(tile.top).toBeLessThan(height);
    }
    expect(tiles.length).toBeLessThanOrEqual(Math.ceil(width / 256 + 1) * Math.ceil(height / 256 + 1));
    expect(new Set(tiles.map((tile) => `${String(tile.x)}/${String(tile.y)}`)).size).toBe(tiles.length);
    expect(tiles.every((tile) => tile.z === 16)).toBe(true);
  });

  it('never asks for a row above or below the world', () => {
    const north = tilesInView({ latitude: 85, longitude: 10 }, 2, 600, 600);
    expect(north.every((tile) => tile.y >= 0 && tile.y < 4)).toBe(true);
    const south = tilesInView({ latitude: -85, longitude: 10 }, 0, 600, 600);
    expect(south.every((tile) => tile.y === 0)).toBe(true);
  });

  it('puts the centre of the view where the centre place is', () => {
    const at = toScreen(cusco, cusco, 16, 400, 220);
    expect(at).toEqual({ x: 200, y: 110 });
  });
});

describe('screen points', () => {
  it('round-trips a screen point to a place and back', () => {
    const point = { x: 123, y: 45 };
    const place = fromScreen(point, cusco, 17, 400, 220);
    const back = toScreen(place, cusco, 17, 400, 220);
    expect(back.x).toBeCloseTo(point.x, 4);
    expect(back.y).toBeCloseTo(point.y, 4);
  });

  it('pans by screen pixels', () => {
    const next = panned(cusco, 16, 100, 0);
    expect(toScreen(cusco, next, 16, 400, 220).x).toBeCloseTo(100, 4);
    expect(next.longitude).toBeGreaterThan(cusco.longitude);
  });

  it('zooms with the anchor staying under the pointer, and holds the limits', () => {
    const anchor = { x: 300, y: 50 };
    const before = fromScreen(anchor, cusco, 16, 400, 220);
    const zoomed = zoomedAround(cusco, 16, 17, anchor, 400, 220);
    expect(zoomed.zoom).toBe(17);
    const after = fromScreen(anchor, zoomed.center, 17, 400, 220);
    expect(after.latitude).toBeCloseTo(before.latitude, 6);
    expect(after.longitude).toBeCloseTo(before.longitude, 6);
    expect(zoomedAround(cusco, 19, 20, anchor, 400, 220).zoom).toBe(19);
    expect(zoomedAround(cusco, 0, -1, anchor, 400, 220).zoom).toBe(0);
  });

  it('halves a metre-per-pixel with each zoom, and shrinks with latitude', () => {
    expect(metresPerPixel(0, 17) * 2).toBeCloseTo(metresPerPixel(0, 16), 6);
    expect(metresPerPixel(60, 10)).toBeCloseTo(metresPerPixel(0, 10) / 2, 3);
  });
});
