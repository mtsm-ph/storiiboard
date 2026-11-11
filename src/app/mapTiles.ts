import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { getLocale, localizeError, t } from '../core/i18n';
import { isTauriApp } from './fileAccess';
import { offReason, offReasonFrom } from './servicesStatus';
import { createTileQueue } from './tileQueue';

export { TileDropped } from './tileQueue';

// The map's tiles (4.9): on the desktop through Rust (src-tauri/src/tiles.rs: the service switch, the host list, the
// app's User-Agent, at most 2 requests at a time, a cache on disk that honours the server's cache headers). The page
// asks for the tiles it is drawing and nothing else, so OpenStreetMap's tile policy (only tiles in view, no
// prefetching, no offline download) holds from here too: a queue (tileQueue.ts) drops what is no longer in view before
// it is asked for. A browser build (the end-to-end tests, `?files=memory`) has no tiles and contacts nothing: the map
// draws a plain grid.

/** Whether this build can show map tiles at all. */
export const tilesOnline = isTauriApp;

/** A tile server of the person's own (Settings → Online services). */
export interface TileProvider {
  template: string;
  attribution: string;
  host: string;
}

const isProvider = (value: unknown): value is TileProvider => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.template === 'string' && typeof v.attribution === 'string' && typeof v.host === 'string';
};

/**
 * The provider set on this computer, or null for OpenStreetMap. `loaded` once Rust has answered, which the map waits
 * for before it asks for any tile; `failed` when Rust could not be read, and then no tile is asked for at all (it
 * would be a guess which server they come from).
 */
const providerStore = createStore<{ provider: TileProvider | null; loaded: boolean; failed: boolean }>()(() => ({ provider: null, loaded: !isTauriApp, failed: false }));

export const useTileProvider = (): TileProvider | null => useStore(providerStore, (s) => s.provider);

/** Whether the provider has been read (always, in a browser build). */
export const useTileProviderLoaded = (): boolean => useStore(providerStore, (s) => s.loaded);

/** Whether reading the provider failed. */
export const useTileProviderFailed = (): boolean => useStore(providerStore, (s) => s.failed);

let asked = false;
/** Reads the provider from Rust once; a failed read is tried again the next time. A browser build has none. */
export async function loadTileProvider(): Promise<void> {
  if (!isTauriApp || asked) return;
  asked = true;
  try {
    const answer = await invoke<unknown>('map_tile_provider');
    providerStore.setState({ provider: isProvider(answer) ? answer : null, loaded: true, failed: false });
  } catch {
    asked = false;
    providerStore.setState({ failed: true });
  }
}

/** What setting a provider came to: saved, back to OpenStreetMap, or the person said no when asked. */
export type ProviderOutcome = 'set' | 'cleared' | 'cancelled';

/**
 * Rust checks the address, asks the person (in a system window naming the host) and saves; its refusal is thrown for
 * the caller to word. Nothing changes when the person cancels.
 */
export async function setTileProvider(template: string, attribution: string): Promise<{ outcome: ProviderOutcome; host: string }> {
  const answer = await invoke<unknown>('map_tile_provider_set', { template, attribution, language: getLocale() });
  const v = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
  if (v.status === 'cancelled') return { outcome: 'cancelled', host: '' };
  const provider = isProvider(v.provider) ? v.provider : null;
  providerStore.setState({ provider, loaded: true, failed: false });
  // Tiles of the old server are not the new one's.
  forgetTiles();
  // The host Rust saved, for the notice: not the page's own reading of the address.
  return { outcome: provider ? 'set' : 'cleared', host: provider?.host ?? '' };
}

// --- Tiles ---------------------------------------------------------------------------------------------------

/** The most pictures kept in memory: a few screens' worth. */
const MEMORY = 300;
/** A tile that failed is not asked for again for this long (a refusal or a lost connection costs one try, not many). */
const RETRY_AFTER = 30_000;
/** Rust keeps to 2 as well (OpenStreetMap's policy). */
const IN_FLIGHT = 2;

/** The words for why a tile didn't come: a switched-off service by its reason, else the error as the app words it. */
export function tileProblem(error: unknown): string {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  const off = offReasonFrom(text);
  return off === null ? localizeError(text) : offReason(off);
}

async function fetchImage(z: number, x: number, y: number): Promise<HTMLImageElement> {
  const bytes = await invoke<ArrayBuffer>('map_tile', { z, x, y });
  const url = URL.createObjectURL(new Blob([bytes]));
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        resolve(image);
      };
      image.onerror = () => {
        reject(new Error(t('error.oddAnswer')));
      };
      image.src = url;
    });
  } finally {
    // The picture is decoded by now (or has failed); the address is no longer needed.
    URL.revokeObjectURL(url);
  }
}

const queue = createTileQueue(fetchImage, IN_FLIGHT, MEMORY, RETRY_AFTER);

/** Says which tiles are in view; queued ones outside it are dropped before they are asked for. Call before `tileImage`. */
export const wantTiles = queue.want;

/** Everything held in memory is dropped (a new provider, Clear). */
export function forgetTiles(): void {
  queue.forget();
}

/**
 * The tile as a picture, queued behind at most 2 asked at once. Rejects with `TileDropped` if its view moved on before
 * it was asked for. Never called in a browser build.
 */
export const tileImage = queue.get;

// --- Settings → Storage ---------------------------------------------------------------------------------------

export interface TilesInfo {
  tiles: number;
  bytes: number;
  capBytes: number;
}

const isInfo = (value: unknown): value is TilesInfo => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.tiles === 'number' && typeof v.bytes === 'number' && typeof v.capBytes === 'number';
};

/** What the tile cache holds; null in a browser build, which keeps none. */
export async function tilesInfo(): Promise<TilesInfo | null> {
  if (!isTauriApp) return null;
  const answer = await invoke<unknown>('map_tiles_info');
  return isInfo(answer) ? answer : null;
}

/** Deletes the kept tiles; how many there were. */
export async function clearTiles(): Promise<number> {
  forgetTiles();
  if (!isTauriApp) return 0;
  const count = await invoke<unknown>('map_tiles_clear');
  return typeof count === 'number' ? count : 0;
}
