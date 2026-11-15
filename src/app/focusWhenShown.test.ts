import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusWhenShown } from './focusWhenShown';

// Focus on something in a tile just opened (6.6 second review): tried each frame until it shows, cancelled by a second
// ask, stopped when the person has moved focus meanwhile, and never on something disabled, hidden or gone. The unit
// tests run in Node without a DOM, so the page is a small stand-in: animation frames run when a test says, and an
// element is what focusWhenShown reads of one.

interface FakeElement {
  name: string;
  isConnected: boolean;
  disabled: boolean;
  style: { display: string };
  parentElement: FakeElement | null;
  matches: (selector: string) => boolean;
  focus: () => void;
}

let frames = new Map<number, () => void>();
let nextFrame = 0;
const page: { activeElement: FakeElement | null; body: FakeElement } = { activeElement: null, body: element('body') };

function element(name: string): FakeElement {
  const made: FakeElement = {
    name,
    isConnected: true,
    disabled: false,
    style: { display: '' },
    parentElement: null,
    matches: (selector) => selector === ':disabled' && made.disabled,
    focus: () => {
      page.activeElement = made;
    },
  };
  return made;
}

/** Runs the frames asked for so far (each may ask for the next). */
function frame(): void {
  const now = [...frames.values()];
  frames = new Map();
  for (const run of now) run();
}

const asElement = (e: FakeElement | null) => e as unknown as HTMLElement | null;

beforeEach(() => {
  frames = new Map();
  page.body = element('body');
  page.activeElement = page.body;
  vi.stubGlobal('document', page);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    nextFrame += 1;
    frames.set(nextFrame, run);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('getComputedStyle', (e: FakeElement) => ({ display: e.style.display }));
});

afterEach(() => {
  // Nothing left waiting for the next test.
  frame();
  vi.unstubAllGlobals();
});

describe('focusWhenShown', () => {
  it('tries each frame until the element shows, then focuses it once', () => {
    let shown: FakeElement | null = null;
    const onFocus = vi.fn();
    focusWhenShown(() => asElement(shown), onFocus);
    frame();
    frame();
    expect(page.activeElement).toBe(page.body);
    shown = element('row');
    frame();
    expect(page.activeElement).toBe(shown);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('gives up after 30 frames, telling find which try is the last', () => {
    const tries: boolean[] = [];
    focusWhenShown((last) => {
      tries.push(last);
      return null;
    });
    for (let i = 0; i < 40; i += 1) frame();
    expect(tries).toHaveLength(30);
    expect(tries.slice(0, 29).every((last) => !last)).toBe(true);
    expect(tries.at(-1)).toBe(true);
  });

  it('is cancelled by a second ask: only the newer one focuses', () => {
    const first = element('first');
    const second = element('second');
    let firstShown = false;
    const firstFind = vi.fn(() => asElement(firstShown ? first : null));
    focusWhenShown(firstFind);
    frame();
    focusWhenShown(() => asElement(second));
    firstShown = true;
    frame();
    expect(page.activeElement).toBe(second);
    frame();
    expect(firstFind).toHaveBeenCalledTimes(1);
    expect(page.activeElement).toBe(second);
  });

  it('stops once focus has moved elsewhere, and keeps going while it is on the page or where it was', () => {
    const button = element('button');
    page.activeElement = button;
    let shown: FakeElement | null = null;
    focusWhenShown(() => asElement(shown));
    frame();
    // The tile that had it unmounted: focus on the page itself, still waiting.
    page.activeElement = page.body;
    frame();
    expect(frames.size).toBe(1);
    // The person clicked into a field: never taken from there.
    const field = element('field');
    page.activeElement = field;
    shown = element('row');
    frame();
    expect(page.activeElement).toBe(field);
    expect(frames.size).toBe(0);
  });

  it('counts a disabled, hidden or no longer connected element as not found yet', () => {
    const row = element('row');
    const parent = element('tile');
    row.parentElement = parent;
    row.disabled = true;
    focusWhenShown(() => asElement(row));
    frame();
    expect(page.activeElement).toBe(page.body);
    row.disabled = false;
    parent.style.display = 'none';
    frame();
    expect(page.activeElement).toBe(page.body);
    parent.style.display = '';
    row.isConnected = false;
    frame();
    expect(page.activeElement).toBe(page.body);
    row.isConnected = true;
    frame();
    expect(page.activeElement).toBe(row);
  });
});
