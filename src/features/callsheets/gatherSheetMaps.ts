import { TileDropped, tileBytes, tileMissingWords, tileProviderNow, tilesOnline, wantTiles } from '../../app/mapTiles';
import { t } from '../../core/i18n';
import type { CallSheet } from '../../core/model/callsheet';
import { mapCredit } from '../locations/mapView';
import { composeMap } from './composeMap';
import { mapTilesFor, tileKey, type GatheredMap } from './sheetMap';

// Gathers the tiles the PDF's maps need (4.10) and composes each map into one picture before the PDF is drawn, so
// callSheetPdf stays pure. The tiles come through the same queue as the screen's maps (src/app/tileQueue.ts: at most 2
// out, Rust's cache and OpenStreetMap's policy behind it): the few tiles a map shows, at zoom 16, and nothing else. A
// browser build has no tiles and asks for none.

/** How long the PDF waits for tiles before it prints what it has. */
export const TILE_WAIT_MS = 10_000;

let gathers = 0;

type Outcome = { bytes: Uint8Array } | { failed: unknown } | { late: true };

export async function gatherSheetMaps(sheet: CallSheet, waitMs: number = TILE_WAIT_MS, only?: ReadonlySet<string>): Promise<Map<string, GatheredMap>> {
  const maps = new Map<string, GatheredMap>();
  const places = sheet.locations.flatMap((l) => (l.place && (!only || only.has(l.record.id)) ? [{ id: l.record.id, place: { latitude: l.place.latitude, longitude: l.place.longitude } }] : []));
  if (places.length === 0) return maps;
  if (!tilesOnline) {
    for (const { id, place } of places) maps.set(id, { kind: 'grid', credit: mapCredit(null).text, at: place });
    return maps;
  }
  let provider;
  try {
    provider = await tileProviderNow();
  } catch (error) {
    // A provider that can't be read: no tile is asked for (it would be a guess which server they come from).
    for (const { id, place } of places) maps.set(id, { kind: 'none', why: tileMissingWords(error), at: place });
    return maps;
  }
  const credit = mapCredit(provider).text;
  // Its own owner: another export or issue running at the same time never drops this one's tiles, nor this one theirs.
  const owner = `call-sheet-pdf:${String(++gathers)}`;
  const wanted = places.map(({ id, place }) => ({ id, place, tiles: mapTilesFor(place) }));
  wantTiles(
    wanted.flatMap((w) => w.tiles),
    owner,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({ late: true });
    }, waitMs);
  });
  try {
    // Every location's tiles are asked for at once (the queue keeps 2 out at a time), so that after the deadline nothing
    // new is asked for; what is still waiting is dropped below. A tile dropped meanwhile counts as late, not as offline.
    const asked = wanted.map(({ tiles }) =>
      Promise.all(
        tiles.map((tile) =>
          Promise.race<Outcome>([
            tileBytes(tile.z, tile.x, tile.y).then(
              (bytes): Outcome => ({ bytes }),
              (failed: unknown): Outcome => (failed instanceof TileDropped ? { late: true } : { failed }),
            ),
            deadline,
          ]),
        ),
      ),
    );
    for (const [n, got] of wanted.entries()) {
      const outcomes = (await asked[n]) ?? [];
      const have = new Map<string, Uint8Array>();
      let why: string | null = null;
      for (const [k, outcome] of outcomes.entries()) {
        const tile = got.tiles[k];
        if (!tile) continue;
        if ('bytes' in outcome) have.set(tileKey(tile), outcome.bytes);
        else if ('failed' in outcome) why ??= tileMissingWords(outcome.failed);
      }
      // A canvas that fails (or isn't there) is an empty frame: a map never stops a sheet.
      const jpeg = have.size > 0 ? await composeMap(got.place, have).catch(() => null) : null;
      maps.set(got.id, jpeg ? { kind: 'image', jpeg, credit, at: got.place } : { kind: 'none', why: why ?? t('callSheet.pdf.mapOffline'), at: got.place });
    }
  } finally {
    clearTimeout(timer);
    // Whatever is still waiting is not asked for after the PDF has gone on without it.
    wantTiles([], owner);
  }
  return maps;
}
