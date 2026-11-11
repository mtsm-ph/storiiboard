import { clampZoom, fromScreen, panned, toScreen, zoomedAround, type LatLon } from '../../core/model/mercator';
import { t } from '../../core/i18n';
import type { TileProvider } from '../../app/mapTiles';

// What the Locations tile's map does with the keyboard and what its credit says (4.9), apart from the drawing so both
// can be tested without a canvas.

export interface MapView {
  center: LatLon;
  zoom: number;
}

export const MAP_HEIGHT = 220;

/** Screen pixels an arrow key pans the map (Shift: a longer step), and moves the pin when it is being moved. */
const PAN_STEP = 64;
const PAN_STEP_LONG = 192;
const PIN_STEP = 8;
const PIN_STEP_LONG = 40;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The zoom change a key asks for: + (or =, its unshifted key) in, - out, else none. */
function zoomStep(key: string): 1 | -1 | 0 {
  if (key === '+' || key === '=') return 1;
  if (key === '-' || key === '_') return -1;
  return 0;
}

/** The view after a key: the arrows pan it, + and - zoom round the middle; null for any other key. */
export function viewAfterKey(view: MapView, key: string, shift: boolean, width: number, height: number): MapView | null {
  const arrow = ARROWS[key];
  if (arrow) {
    const step = shift ? PAN_STEP_LONG : PAN_STEP;
    return { zoom: view.zoom, center: panned(view.center, view.zoom, arrow[0] * step, arrow[1] * step) };
  }
  const zoom = zoomStep(key);
  if (zoom !== 0) return zoomedAround(view.center, view.zoom, view.zoom + zoom, { x: width / 2, y: height / 2 }, width, height);
  return null;
}

/** The pin after an arrow key while it is being moved (a step of screen pixels, so it feels the same at any zoom). */
export function pinAfterKey(pin: LatLon, view: MapView, key: string, shift: boolean, width: number, height: number): LatLon | null {
  const arrow = ARROWS[key];
  if (!arrow) return null;
  const step = shift ? PIN_STEP_LONG : PIN_STEP;
  const at = toScreen(pin, view.center, view.zoom, width, height);
  const next = fromScreen({ x: at.x + arrow[0] * step, y: at.y + arrow[1] * step }, view.center, view.zoom, width, height);
  // The coordinate an arrow doesn't move stays exactly as it was: past 85.05 degrees the map can't draw a latitude, and
  // a step sideways must not pull the stored one back to the map's edge.
  return arrow[0] !== 0 ? { latitude: pin.latitude, longitude: next.longitude } : { latitude: next.latitude, longitude: pin.longitude };
}

/** The view with the zoom changed by buttons: round the middle, held between 0 and 19. */
export function viewZoomed(view: MapView, by: 1 | -1, width: number, height: number): MapView {
  return zoomedAround(view.center, view.zoom, clampZoom(view.zoom + by), { x: width / 2, y: height / 2 }, width, height);
}

/** Whether a place is on screen with `margin` pixels to spare. */
export function onScreen(place: LatLon, view: MapView, width: number, height: number, margin = 12): boolean {
  const at = toScreen(place, view.center, view.zoom, width, height);
  return at.x >= margin && at.x <= width - margin && at.y >= margin && at.y <= height - margin;
}

export const COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * The credit on the map, never left off: "© OpenStreetMap contributors" (linking to its copyright page) for
 * OpenStreetMap's tiles; for a server of one's own, "Map tiles: <host>" and the attribution the person entered.
 */
export function mapCredit(provider: TileProvider | null): { text: string; href: string | null } {
  if (provider === null) return { text: t('map.credit'), href: COPYRIGHT_URL };
  return {
    text: provider.attribution === '' ? t('map.creditOwn', { host: provider.host }) : t('map.creditOwnWith', { host: provider.host, attribution: provider.attribution }),
    href: null,
  };
}
