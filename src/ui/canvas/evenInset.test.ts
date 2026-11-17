import { describe, expect, it } from 'vitest';
import { PLAN_STRIP_INSET, planViewportOf } from '../../features/birdseye/plan/planStore';
import { RULER_SIZE } from './Rulers';
import { STRIP_INSET } from './stripTools';
import { evenInset, firstViewBeside, fitBeside, fitBounds, middleBeside, toScreen, toWorld } from './viewport';

// 6.28: a view beside the tools' strip is moved by half the strip's inset, and half of an odd inset is half a pixel. At
// 100% the world's whole units then sat between the screen's pixels: a Mac's WebKit, whose pointer is on whole pixels,
// read a click on a plan half a centimetre off. A host hands the view's functions an even inset.

const whole = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;
const INSETS = [0, 1, 2, 17, 18, 50, 51, 52, 68, 69, 70, 71];

describe('an even inset beside the tools’ strip', () => {
  it('is the inset itself when even, the next pixel up when odd, never less', () => {
    expect(INSETS.map(evenInset)).toEqual([0, 2, 2, 18, 18, 50, 52, 52, 68, 70, 70, 72]);
    for (const inset of INSETS) expect(evenInset(inset)).toBeGreaterThanOrEqual(inset);
    // What the two hosts hand on: a board's 51 px as 52, a plan's 51 + 18 as 70.
    expect(STRIP_INSET + RULER_SIZE).toBe(69);
    expect(evenInset(STRIP_INSET)).toBe(52);
    expect(PLAN_STRIP_INSET).toBe(70);
  });

  it('puts the first view’s origin a whole number of pixels from the canvas’s middle, for odd and even insets and widths', () => {
    for (const inset of INSETS) {
      const first = firstViewBeside(evenInset(inset));
      expect(first.zoom).toBe(1);
      expect(whole(first.cx)).toBe(true);
      for (const width of [640, 641, 710, 851, 852, 1281]) {
        const size = { width, height: 600 };
        const origin = toScreen(first, size, { x: 0, y: 0 });
        // From the canvas's middle, which is where a view without a strip has it: whole pixels, whatever the width.
        expect(whole(origin.x - width / 2)).toBe(true);
        // So on a whole pixel exactly where a view without a strip is: an even width. An odd width has its own middle
        // on a half pixel, strip or no strip, as it always had.
        expect(whole(origin.x)).toBe(width % 2 === 0);
        expect(whole(origin.y)).toBe(true);
        // A whole pixel under the pointer is a whole unit of the world, and back.
        const pointer = { x: Math.floor(width / 2) + 123, y: 77 };
        expect(whole(toWorld(first, size, pointer).x - (width % 2 === 0 ? 0 : 0.5))).toBe(true);
        expect(toScreen(first, size, toWorld(first, size, pointer))).toEqual(pointer);
      }
    }
  });

  it('is what the odd inset was not: half of 69 put the origin half a pixel off', () => {
    const size = { width: 710, height: 650 };
    expect(toScreen(firstViewBeside(STRIP_INSET + RULER_SIZE), size, { x: 0, y: 0 }).x).toBe(389.5);
    expect(toScreen(firstViewBeside(PLAN_STRIP_INSET), size, { x: 0, y: 0 }).x).toBe(390);
  });

  it('is a plan’s first view: 100%, the origin 35 px right of the canvas’s middle, where the keyboard places', () => {
    const first = planViewportOf({}, 'any');
    expect(first).toEqual({ cx: -35, cy: 0, zoom: 1 });
    expect(middleBeside(first, PLAN_STRIP_INSET)).toEqual({ x: 0, y: 0 });
    // Panned by whole pixels, the keyboard's middle stays on a whole unit.
    expect(middleBeside({ cx: 120, cy: -40, zoom: 1 }, PLAN_STRIP_INSET)).toEqual({ x: 155, y: -40 });
    // A view the person moved is kept as it is.
    expect(planViewportOf({ any: { cx: 3.25, cy: 1, zoom: 2 } }, 'any')).toEqual({ cx: 3.25, cy: 1, zoom: 2 });
  });

  it('moves a fit by whole pixels from the plain fit of the same room, at 100% and zoomed out', () => {
    for (const inset of INSETS) {
      const left = evenInset(inset);
      for (const width of [640, 851, 934, 1281]) {
        const size = { width, height: 600 };
        for (const bounds of [
          { x: -100, y: -50, width: 200, height: 100 },
          { x: 0, y: 0, width: 1920, height: 1080 },
          { x: -704, y: 3, width: 1408, height: 10 },
        ]) {
          const beside = fitBeside(bounds, size, left);
          const middle = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          // The bounds' middle lands in the middle of what is seen right of the strip: half the inset, whole pixels,
          // from the canvas's own middle, where a plain fit puts it.
          expect(toScreen(beside, size, middle).x - width / 2).toBeCloseTo(left / 2, 9);
          expect(whole(left / 2)).toBe(true);
          expect(toScreen(beside, size, middle).y).toBeCloseTo(300, 9);
          // The same zoom as a plain fit into the room right of the strip.
          expect(beside.zoom).toBe(fitBounds(bounds, { width: width - left, height: 600 }).zoom);
        }
      }
    }
    // At 100%, whole bounds in an even canvas: a whole centre, so whole units on whole pixels.
    expect(fitBeside({ x: -100, y: -50, width: 200, height: 100 }, { width: 852, height: 600 }, evenInset(STRIP_INSET))).toEqual({ zoom: 1, cx: -26, cy: 0 });
  });
});
