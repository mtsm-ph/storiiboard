import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callSheet } from '../../core/model/callsheet';
import type { Props, SbdRecord } from '../../core/model/record';
import { mapTilesFor, tileKey } from './sheetMap';

// Gathering the tiles for the PDF's maps (4.10), against a fake tile path: never the network. The picture itself is
// composed on a canvas (composeMap.ts, tested in the browser by the end-to-end tests), so it is faked here.

const mocks = vi.hoisted(() => {
  class TileDropped extends Error {}
  return {
    TileDropped,
    online: true,
    bytes: vi.fn<(z: number, x: number, y: number) => Promise<Uint8Array>>(),
    want: vi.fn<(tiles: readonly { z: number; x: number; y: number }[], owner?: string) => void>(),
    provider: vi.fn<() => Promise<{ template: string; attribution: string; host: string } | null>>(),
    compose: vi.fn<(place: { latitude: number; longitude: number }, tiles: ReadonlyMap<string, Uint8Array>) => Promise<Uint8Array | null>>(),
  };
});

vi.mock('../../app/mapTiles', () => ({
  TileDropped: mocks.TileDropped,
  get tilesOnline() {
    return mocks.online;
  },
  tileBytes: mocks.bytes,
  wantTiles: mocks.want,
  tileProviderNow: mocks.provider,
  tileMissingWords: (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    return text.startsWith('service-off:') ? 'This service is switched off.' : 'Map not available offline';
  },
}));
vi.mock('./composeMap', () => ({ composeMap: mocks.compose }));

const { gatherSheetMaps } = await import('./gatherSheetMaps');

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id, type, parentId, sortKey: id, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at,
});
const cusco = { latitude: -13.5167674, longitude: -71.9787787 };
const lima = { latitude: -12.0464, longitude: -77.0428 };

function sheet(places: 'one' | 'two' | 'none' = 'one') {
  const second = places === 'two';
  const records = Object.fromEntries(
    [
      record('p', 'project', null, { title: 'Bey County' }),
      record('d', 'shoot_day', 'p', { date: '2026-11-16', call_time: '07:00' }),
      record('loc', 'location', 'p', { name: 'Diner', address: '12 Route 9', ...(places === 'none' ? {} : { map_name: 'Cusco', ...cusco }) }),
      record('s1', 'scene', 'p', { number: '1', location_id: 'loc' }),
      record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
      ...(second
        ? [
            record('loc2', 'location', 'p', { name: 'Hotel', address: '1 Calle Lima', map_name: 'Lima', ...lima }),
            record('b', 'shot', 's1', { number: '1B', shoot_day_id: 'd', location_id: 'loc2' }),
          ]
        : []),
    ].map((r) => [r.id, r]),
  );
  const result = callSheet(records, 'p', 'd', undefined, new Map([['loc', 'America/Lima'], ['loc2', 'America/Lima']]));
  if (!result) throw new Error('no sheet');
  return result;
}

const png = new Uint8Array([1, 2, 3]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
beforeEach(() => {
  mocks.online = true;
  mocks.bytes.mockReset();
  mocks.want.mockReset();
  mocks.provider.mockReset();
  mocks.compose.mockReset();
  mocks.provider.mockResolvedValue(null);
  mocks.compose.mockResolvedValue(jpeg);
});

describe('gathering the sheet’s map pictures', () => {
  it('asks for exactly the tiles the frame needs and composes them into one picture with the credit and the place', async () => {
    mocks.bytes.mockResolvedValue(png);
    const maps = await gatherSheetMaps(sheet());
    const needed = mapTilesFor(cusco);
    expect(mocks.bytes.mock.calls.map(([z, x, y]) => tileKey({ z, x, y })).sort()).toEqual(needed.map(tileKey).sort());
    expect(mocks.bytes.mock.calls.length).toBeLessThanOrEqual(6);
    expect(maps.get('loc')).toEqual({ kind: 'image', jpeg, credit: '© OpenStreetMap contributors', at: cusco });
    expect(mocks.compose.mock.calls[0]?.[1].size).toBe(needed.length);
    expect(mocks.want.mock.calls.at(-1)?.[0]).toEqual([]);
  });

  it('uses the own provider’s credit', async () => {
    mocks.provider.mockResolvedValue({ template: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: 'Data by Example', host: 'tiles.example.com' });
    mocks.bytes.mockResolvedValue(png);
    const map = (await gatherSheetMaps(sheet())).get('loc');
    expect(map?.kind === 'image' ? map.credit : '').toBe('Map tiles: tiles.example.com. Data by Example');
  });

  it('keeps the tiles that came when some failed; with none, says why (the switch’s words, or offline) and has no credit', async () => {
    const needed = mapTilesFor(cusco);
    mocks.bytes.mockImplementation((z, x, y) => (tileKey({ z, x, y }) === tileKey(needed[0] ?? { z: 0, x: 0, y: 0 }) ? Promise.resolve(png) : Promise.reject(new Error('offline'))));
    await gatherSheetMaps(sheet());
    expect(mocks.compose.mock.calls[0]?.[1].size).toBe(1);

    mocks.bytes.mockRejectedValue(new Error('service-off:maintenance'));
    expect((await gatherSheetMaps(sheet())).get('loc')).toEqual({ kind: 'none', why: 'This service is switched off.', at: cusco });
    mocks.bytes.mockRejectedValue(new Error('offline'));
    expect((await gatherSheetMaps(sheet())).get('loc')).toEqual({ kind: 'none', why: 'Map not available offline', at: cusco });
  });

  it('is an empty frame with no credit when no tile could be drawn, even if some came', async () => {
    mocks.bytes.mockResolvedValue(png);
    mocks.compose.mockResolvedValue(null);
    expect((await gatherSheetMaps(sheet())).get('loc')).toEqual({ kind: 'none', why: 'Map not available offline', at: cusco });
  });

  it('turns a canvas that fails (no OffscreenCanvas and no <canvas>, an encoder that throws) into an empty frame, not a failed sheet', async () => {
    mocks.bytes.mockResolvedValue(png);
    mocks.compose.mockRejectedValue(new Error('OffscreenCanvas is not defined'));
    expect((await gatherSheetMaps(sheet())).get('loc')).toEqual({ kind: 'none', why: 'Map not available offline', at: cusco });
  });

  it('gathers again only the locations asked for', async () => {
    mocks.bytes.mockResolvedValue(png);
    const maps = await gatherSheetMaps(sheet('two'), 1000, new Set(['loc2']));
    expect([...maps.keys()]).toEqual(['loc2']);
    expect(mocks.bytes.mock.calls.length).toBe(mapTilesFor(lima).length);
  });

  it('counts a tile dropped from the queue as late, not as offline', async () => {
    mocks.bytes.mockRejectedValue(new mocks.TileDropped('dropped'));
    const map = (await gatherSheetMaps(sheet())).get('loc');
    expect(map).toEqual({ kind: 'none', why: 'Map not available offline', at: cusco });
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('stops waiting after the time limit, asks for every location’s tiles at once and for none afterwards, and lets go of them', async () => {
    mocks.bytes.mockReturnValue(new Promise<Uint8Array>(() => undefined));
    const started = Date.now();
    const maps = await gatherSheetMaps(sheet('two'), 40);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(maps.get('loc')?.kind).toBe('none');
    expect(maps.get('loc2')?.kind).toBe('none');
    // Exactly the two frames' tiles, asked once each, all before the wait began.
    expect(mocks.bytes.mock.calls.length).toBe(mapTilesFor(cusco).length + mapTilesFor(lima).length);
    const before = mocks.bytes.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(mocks.bytes.mock.calls.length).toBe(before);
    expect(mocks.want.mock.calls.at(-1)?.[0]).toEqual([]);
  });

  it('gives each gather its own owner, so one export finishing never drops the tiles another is waiting for', async () => {
    mocks.bytes.mockResolvedValue(png);
    await Promise.all([gatherSheetMaps(sheet()), gatherSheetMaps(sheet())]);
    const owners = mocks.want.mock.calls.map(([, owner]) => owner);
    const wanting = new Set(mocks.want.mock.calls.filter(([tiles]) => tiles.length > 0).map(([, owner]) => owner));
    expect(wanting.size).toBe(2);
    expect(owners.every((owner) => owner?.startsWith('call-sheet-pdf:'))).toBe(true);
    // Each let go of only its own.
    const released = mocks.want.mock.calls.filter(([tiles]) => tiles.length === 0).map(([, owner]) => owner);
    expect(new Set(released)).toEqual(wanting);
  });

  it('asks for nothing in a browser build and draws the grid; a location with no place has no map', async () => {
    mocks.online = false;
    expect((await gatherSheetMaps(sheet())).get('loc')).toEqual({ kind: 'grid', credit: '© OpenStreetMap contributors', at: cusco });
    expect(mocks.bytes).not.toHaveBeenCalled();
    mocks.online = true;
    expect((await gatherSheetMaps(sheet('none'))).size).toBe(0);
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it('asks for no tile when the provider could not be read, and the frame says offline, as for any tile that cannot be had', async () => {
    mocks.provider.mockRejectedValue(new Error('odd answer'));
    expect((await gatherSheetMaps(sheet())).get('loc')).toEqual({ kind: 'none', why: 'Map not available offline', at: cusco });
    expect(mocks.bytes).not.toHaveBeenCalled();
  });
});
