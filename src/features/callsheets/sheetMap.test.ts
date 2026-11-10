import { describe, expect, it } from 'vitest';
import { tileOf, toWorld, TILE_SIZE } from '../../core/model/mercator';
import { MAP_HEIGHT, MAP_WIDTH, MAP_ZOOM, mapTilesFor, POINTS_PER_PIXEL, tileKey } from './sheetMap';

// The tiles the PDF's 60 x 40 mm map needs (4.10): the few that the frame shows at zoom 16, and no others.

const cusco = { latitude: -13.5167674, longitude: -71.9787787 };

describe('the map frame', () => {
  it('is 60 by 40 mm', () => {
    expect(MAP_WIDTH).toBeCloseTo(170.08, 1);
    expect(MAP_HEIGHT).toBeCloseTo(113.39, 1);
    expect(MAP_ZOOM).toBe(16);
  });
});

describe('the tiles a place needs', () => {
  it('are at most 6, all at zoom 16, and include the place’s own tile', () => {
    const tiles = mapTilesFor(cusco);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(6);
    expect(tiles.every((tile) => tile.z === 16)).toBe(true);
    const own = tileOf(cusco, 16);
    expect(tiles.some((tile) => tile.x === own.x && tile.y === own.y)).toBe(true);
    // No tile twice.
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
  });

  it('are the right x and y: the columns and rows that the 340 x 227 px frame covers around the place', () => {
    const world = toWorld(cusco, 16);
    const width = MAP_WIDTH / POINTS_PER_PIXEL;
    const height = MAP_HEIGHT / POINTS_PER_PIXEL;
    const columns = [Math.floor((world.x - width / 2) / TILE_SIZE), Math.floor((world.x + width / 2 - 1e-9) / TILE_SIZE)];
    const rows = [Math.floor((world.y - height / 2) / TILE_SIZE), Math.floor((world.y + height / 2 - 1e-9) / TILE_SIZE)];
    const expected: string[] = [];
    for (let y = rows[0] ?? 0; y <= (rows[1] ?? 0); y += 1) for (let x = columns[0] ?? 0; x <= (columns[1] ?? 0); x += 1) expected.push(`16/${String(x)}/${String(y)}`);
    expect(mapTilesFor(cusco).map(tileKey).sort()).toEqual(expected.sort());
  });

  it('put the place at the frame’s centre, which is where the pin is drawn', () => {
    const world = toWorld(cusco, 16);
    for (const tile of mapTilesFor(cusco)) {
      // The tile's left edge on the frame plus the place's distance into the tile (if it is in this one).
      const inX = world.x - tile.x * TILE_SIZE;
      if (inX >= 0 && inX < TILE_SIZE) expect(tile.left + inX).toBeCloseTo(MAP_WIDTH / POINTS_PER_PIXEL / 2, 6);
      const inY = world.y - tile.y * TILE_SIZE;
      if (inY >= 0 && inY < TILE_SIZE) expect(tile.top + inY).toBeCloseTo(MAP_HEIGHT / POINTS_PER_PIXEL / 2, 6);
    }
  });

  it('wrap across the antimeridian: columns past 180 degrees are the first ones, and none is out of the world', () => {
    const last = 2 ** 16 - 1;
    for (const longitude of [179.9999, -179.9999, 180]) {
      const tiles = mapTilesFor({ latitude: 10, longitude });
      expect(tiles.length).toBeLessThanOrEqual(6);
      expect(tiles.every((tile) => tile.x >= 0 && tile.x <= last)).toBe(true);
    }
    const xs = mapTilesFor({ latitude: 10, longitude: 179.9999 }).map((tile) => tile.x);
    expect(xs).toContain(last);
    expect(xs).toContain(0);
  });

  it('leave out rows above or below the world at the poles', () => {
    const north = mapTilesFor({ latitude: 85.05, longitude: 0 });
    expect(north.every((tile) => tile.y >= 0)).toBe(true);
    const south = mapTilesFor({ latitude: -85.05, longitude: 0 });
    expect(south.every((tile) => tile.y <= 2 ** 16 - 1)).toBe(true);
  });
});
