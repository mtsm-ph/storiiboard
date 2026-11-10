import { describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../../core/i18n';
import { toScreen } from '../../core/model/mercator';
import { COPYRIGHT_URL, mapCredit, onScreen, pinAfterKey, viewAfterKey, viewZoomed, type MapView } from './mapView';

// The map's keyboard and its credit (4.9), without a canvas.

const view: MapView = { center: { latitude: -13.51677, longitude: -71.97875 }, zoom: 16 };
const [W, H] = [400, 220];

describe('the keyboard on the map', () => {
  it('pans with the arrows, further with Shift', () => {
    const right = viewAfterKey(view, 'ArrowRight', false, W, H);
    expect(right?.zoom).toBe(16);
    expect(toScreen(view.center, right?.center ?? view.center, 16, W, H).x).toBeCloseTo(W / 2 - 64, 3);
    const down = viewAfterKey(view, 'ArrowDown', true, W, H);
    expect(toScreen(view.center, down?.center ?? view.center, 16, W, H).y).toBeCloseTo(H / 2 - 192, 3);
    const left = viewAfterKey(view, 'ArrowLeft', false, W, H);
    expect(left?.center.longitude).toBeLessThan(view.center.longitude);
    const up = viewAfterKey(view, 'ArrowUp', false, W, H);
    expect(up?.center.latitude).toBeGreaterThan(view.center.latitude);
  });

  it('zooms with + and -, round the middle, and stops at 0 and 19', () => {
    expect(viewAfterKey(view, '+', false, W, H)?.zoom).toBe(17);
    expect(viewAfterKey(view, '=', false, W, H)?.zoom).toBe(17);
    expect(viewAfterKey(view, '-', false, W, H)?.zoom).toBe(15);
    expect(viewAfterKey({ ...view, zoom: 19 }, '+', false, W, H)?.zoom).toBe(19);
    expect(viewAfterKey({ ...view, zoom: 0 }, '-', false, W, H)?.zoom).toBe(0);
    const zoomed = viewAfterKey(view, '+', false, W, H);
    // The middle stays the middle.
    expect(toScreen(view.center, zoomed?.center ?? view.center, 17, W, H).x).toBeCloseTo(W / 2, 3);
  });

  it('leaves other keys alone', () => {
    expect(viewAfterKey(view, 'a', false, W, H)).toBeNull();
    expect(viewAfterKey(view, 'Enter', false, W, H)).toBeNull();
    expect(pinAfterKey(view.center, view, 'Enter', false, W, H)).toBeNull();
  });

  it('moves the pin by a few screen pixels per arrow, more with Shift', () => {
    const next = pinAfterKey(view.center, view, 'ArrowRight', false, W, H);
    expect(next).not.toBeNull();
    const at = toScreen(next ?? view.center, view.center, 16, W, H);
    expect(at.x).toBeCloseTo(W / 2 + 8, 3);
    expect(at.y).toBeCloseTo(H / 2, 3);
    const far = pinAfterKey(view.center, view, 'ArrowUp', true, W, H);
    expect(toScreen(far ?? view.center, view.center, 16, W, H).y).toBeCloseTo(H / 2 - 40, 3);
  });

  it('keeps a latitude the map cannot draw until the pin is moved up or down', () => {
    const polar: MapView = { center: { latitude: 85, longitude: 10 }, zoom: 10 };
    const pin = { latitude: 87.5, longitude: 10 };
    const sideways = pinAfterKey(pin, polar, 'ArrowLeft', false, W, H);
    expect(sideways?.latitude).toBe(87.5);
    expect(sideways?.longitude).toBeLessThan(10);
    const vertical = pinAfterKey(pin, polar, 'ArrowUp', false, W, H);
    expect(vertical?.longitude).toBe(10);
  });

  it('zooms by the buttons and tells when a place is off the map', () => {
    expect(viewZoomed(view, 1, W, H).zoom).toBe(17);
    expect(viewZoomed({ ...view, zoom: 19 }, 1, W, H).zoom).toBe(19);
    expect(onScreen(view.center, view, W, H)).toBe(true);
    expect(onScreen({ latitude: -13.6, longitude: -71.97875 }, view, W, H)).toBe(false);
  });
});

describe('the credit', () => {
  it('is OpenStreetMap’s, linked to its copyright page, unless there is a server of one’s own', () => {
    expect(mapCredit(null)).toEqual({ text: '© OpenStreetMap contributors', href: COPYRIGHT_URL });
    expect(COPYRIGHT_URL).toBe('https://www.openstreetmap.org/copyright');
  });

  it('names the host of a server of one’s own, and its attribution when one was entered', () => {
    expect(mapCredit({ template: 'https://tiles.example.org/{z}/{x}/{y}.png', attribution: '', host: 'tiles.example.org' })).toEqual({
      text: 'Map tiles: tiles.example.org',
      href: null,
    });
    expect(mapCredit({ template: 'https://tiles.example.org/{z}/{x}/{y}.png', attribution: '© Example Maps', host: 'tiles.example.org' }).text).toBe(
      'Map tiles: tiles.example.org. © Example Maps',
    );
  });

  it('is never empty, in either language', () => {
    const start = getLocale();
    for (const locale of ['en', 'es'] as const) {
      setLocale(locale);
      expect(mapCredit(null).text).toContain('OpenStreetMap');
    }
    setLocale(start);
  });
});
