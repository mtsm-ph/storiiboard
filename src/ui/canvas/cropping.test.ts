import { describe, expect, it } from 'vitest';
import { boxForCrop, cleanCrop, cropDrag, HANDLE_ANCHORS, isWhole, sideKeepingRatio, soleCropItem, wholeBounds, wholePicture, WHOLE, withCropLive, type CropRect } from './cropping';
import type { CanvasItem, DrawContext, Geometry } from './types';

// Cropping a board's picture (6.5.7b): each handle crops along the picture's own axes with the opposite side and the
// picture's pixels left where they were, a reveal stops at the picture's edge, the least size holds, Shift keeps the
// kept part's proportions, and Reset's box keeps what showed in place.

const plain: Geometry = { x: 100, y: 50, width: 400, height: 300, rotation: 0 };
const opts = { min: 8, keepRatio: false };
const close = (a: number, b: number, digits = 2) => {
  expect(a).toBeCloseTo(b, digits);
};

/** A point of the item's own box (fractions of it) on the board. */
function onBoard(g: Geometry, fx: number, fy: number): { x: number; y: number } {
  const turn = (g.rotation * Math.PI) / 180;
  const lx = (fx - 0.5) * g.width;
  const ly = (fy - 0.5) * g.height;
  return { x: g.x + g.width / 2 + Math.cos(turn) * lx - Math.sin(turn) * ly, y: g.y + g.height / 2 + Math.sin(turn) * lx + Math.cos(turn) * ly };
}

/** Where the whole picture's top-left corner is on the board, and its size: what a crop must never move or scale. */
function pictureOnBoard(g: Geometry, crop: CropRect) {
  const whole = wholePicture(g.width, g.height, crop);
  return { corner: onBoard(g, whole.x / g.width, whole.y / g.height), width: whole.width, height: whole.height };
}

/** The point of the box opposite a handle (fractions of the box): it stays put. */
function opposite(anchor: string): { fx: number; fy: number } {
  const fx = anchor.endsWith('left') ? 1 : anchor.endsWith('right') ? 0 : 0.5;
  const fy = anchor.startsWith('top') ? 1 : anchor.startsWith('bottom') ? 0 : 0.5;
  return { fx, fy };
}

/** A drag 40 units inward along the box's own axes (for the axes the handle moves), turned onto the board. */
function inward(g: Geometry, anchor: string): { x: number; y: number } {
  const ax = anchor.endsWith('left') ? 40 : anchor.endsWith('right') ? -40 : 0;
  const ay = anchor.startsWith('top') ? 30 : anchor.startsWith('bottom') ? -30 : 0;
  const turn = (g.rotation * Math.PI) / 180;
  return { x: Math.cos(turn) * ax - Math.sin(turn) * ay, y: Math.sin(turn) * ax + Math.cos(turn) * ay };
}

describe('a crop drag on a plain picture', () => {
  const expected: Record<string, { geometry: Geometry; crop: CropRect }> = {
    'top-left': { geometry: { x: 140, y: 80, width: 360, height: 270, rotation: 0 }, crop: { x: 0.1, y: 0.1, width: 0.9, height: 0.9 } },
    'top-center': { geometry: { x: 100, y: 80, width: 400, height: 270, rotation: 0 }, crop: { x: 0, y: 0.1, width: 1, height: 0.9 } },
    'top-right': { geometry: { x: 100, y: 80, width: 360, height: 270, rotation: 0 }, crop: { x: 0, y: 0.1, width: 0.9, height: 0.9 } },
    'middle-right': { geometry: { x: 100, y: 50, width: 360, height: 300, rotation: 0 }, crop: { x: 0, y: 0, width: 0.9, height: 1 } },
    'bottom-right': { geometry: { x: 100, y: 50, width: 360, height: 270, rotation: 0 }, crop: { x: 0, y: 0, width: 0.9, height: 0.9 } },
    'bottom-center': { geometry: { x: 100, y: 50, width: 400, height: 270, rotation: 0 }, crop: { x: 0, y: 0, width: 1, height: 0.9 } },
    'bottom-left': { geometry: { x: 140, y: 50, width: 360, height: 270, rotation: 0 }, crop: { x: 0.1, y: 0, width: 0.9, height: 0.9 } },
    'middle-left': { geometry: { x: 140, y: 50, width: 360, height: 300, rotation: 0 }, crop: { x: 0.1, y: 0, width: 0.9, height: 1 } },
  };
  for (const anchor of HANDLE_ANCHORS) {
    it(`cuts by the ${anchor} handle, the opposite side and the pixels where they were`, () => {
      const made = cropDrag(plain, WHOLE, anchor, inward(plain, anchor), opts);
      expect(made).toEqual(expected[anchor]);
      const before = pictureOnBoard(plain, WHOLE);
      const after = pictureOnBoard(made.geometry, made.crop);
      close(after.corner.x, before.corner.x);
      close(after.corner.y, before.corner.y);
      close(after.width, before.width);
      close(after.height, before.height);
    });
  }
});

describe('a crop drag on a turned picture', () => {
  const turned: Geometry = { ...plain, rotation: 30 };
  for (const anchor of HANDLE_ANCHORS) {
    it(`cuts by the ${anchor} handle along the picture's own axes`, () => {
      const made = cropDrag(turned, WHOLE, anchor, inward(turned, anchor), opts);
      expect(made.geometry.rotation).toBe(30);
      close(made.geometry.width, anchor.endsWith('left') || anchor.endsWith('right') ? 360 : 400);
      close(made.geometry.height, anchor.startsWith('top') || anchor.startsWith('bottom') ? 270 : 300);
      // The side opposite the handle stays on the board.
      const { fx, fy } = opposite(anchor);
      const was = onBoard(turned, fx, fy);
      const now = onBoard(made.geometry, fx, fy);
      close(now.x, was.x, 1);
      close(now.y, was.y, 1);
      // And the picture neither moves nor scales.
      const before = pictureOnBoard(turned, WHOLE);
      const after = pictureOnBoard(made.geometry, made.crop);
      close(after.corner.x, before.corner.x, 1);
      close(after.corner.y, before.corner.y, 1);
      close(after.width, 400, 1);
      close(after.height, 300, 1);
    });
  }
});

describe('the limits of a crop drag', () => {
  // 320 wide showing 80% of a 400-wide picture, 10% cut off the left.
  const cropped: Geometry = { x: 140, y: 50, width: 320, height: 300, rotation: 0 };
  const crop: CropRect = { x: 0.1, y: 0, width: 0.8, height: 1 };

  it('reveals what was cut up to the picture’s own edge, and no further', () => {
    const right = cropDrag(cropped, crop, 'middle-right', { x: 500, y: 0 }, opts);
    expect(right).toEqual({ geometry: { x: 140, y: 50, width: 360, height: 300, rotation: 0 }, crop: { x: 0.1, y: 0, width: 0.9, height: 1 } });
    const left = cropDrag(cropped, crop, 'middle-left', { x: -500, y: 0 }, opts);
    expect(left).toEqual({ geometry: { x: 100, y: 50, width: 360, height: 300, rotation: 0 }, crop: { x: 0, y: 0, width: 0.9, height: 1 } });
    // Nothing was cut off the top: dragging it out reveals nothing.
    expect(cropDrag(cropped, crop, 'top-center', { x: 0, y: -100 }, opts)).toEqual({ geometry: cropped, crop });
  });

  it('never leaves a side under the least size', () => {
    const made = cropDrag(plain, WHOLE, 'middle-right', { x: -1000, y: 0 }, { min: 12, keepRatio: false });
    expect(made.geometry.width).toBe(12);
    expect(made.geometry.x).toBe(100);
    close(made.crop.width, 0.03, 6);
    const corner = cropDrag(plain, WHOLE, 'top-left', { x: 1000, y: 1000 }, { min: 12, keepRatio: false });
    expect([corner.geometry.width, corner.geometry.height]).toEqual([12, 12]);
    expect([corner.geometry.x + corner.geometry.width, corner.geometry.y + corner.geometry.height]).toEqual([500, 350]);
  });

  it('keeps the kept part’s proportions with Shift: by a corner, and by an edge about the other axis’s middle', () => {
    const corner = cropDrag(plain, WHOLE, 'bottom-right', { x: -40, y: -10 }, { min: 8, keepRatio: true });
    close(corner.geometry.width / corner.geometry.height, 4 / 3, 3);
    expect([corner.geometry.x, corner.geometry.y]).toEqual([100, 50]);
    close(corner.geometry.height, 290);
    const edge = cropDrag(plain, WHOLE, 'middle-right', { x: -40, y: 0 }, { min: 8, keepRatio: true });
    expect(edge.geometry).toEqual({ x: 100, y: 65, width: 360, height: 270, rotation: 0 });
    expect(edge.crop).toEqual({ x: 0, y: 0.05, width: 0.9, height: 0.9 });
    // Outward, it stops where either axis meets the picture's edge.
    const out = cropDrag({ x: 140, y: 80, width: 320, height: 240, rotation: 0 }, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 'bottom-right', { x: 500, y: 500 }, { min: 8, keepRatio: true });
    expect(out.crop).toEqual({ x: 0.1, y: 0.1, width: 0.9, height: 0.9 });
  });
});

describe('Reset crop’s box', () => {
  it('is the whole picture, the part that showed exactly where it was', () => {
    const g: Geometry = { x: 0, y: 0, width: 200, height: 180, rotation: 0 };
    const crop: CropRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    expect(boxForCrop(g, crop, WHOLE)).toEqual({ x: -40, y: -60, width: 400, height: 300, rotation: 0 });
  });

  it('keeps a turned picture in place too', () => {
    const g: Geometry = { x: 10, y: 20, width: 200, height: 180, rotation: 45 };
    const crop: CropRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    const box = boxForCrop(g, crop, WHOLE);
    const before = pictureOnBoard(g, crop);
    const after = pictureOnBoard(box, WHOLE);
    close(after.corner.x, before.corner.x, 1);
    close(after.corner.y, before.corner.y, 1);
    expect([box.width, box.height, box.rotation]).toEqual([400, 300, 45]);
  });
});

describe('the crop as stored', () => {
  it('is the whole picture when near enough to it, and never runs past the picture', () => {
    expect(isWhole(cleanCrop({ x: 0.0000004, y: 0, width: 0.9999996, height: 1 }))).toBe(true);
    expect(cleanCrop({ x: 0.3, y: 0.2, width: 0.9, height: 0.5 })).toEqual({ x: 0.3, y: 0.2, width: 0.7, height: 0.5 });
  });
});

describe('a picture’s middle handle dragged plainly', () => {
  it('keeps the proportions, the other side following about its middle', () => {
    const was = { x: 0, y: 0, width: 400, height: 300, rotation: 0 };
    expect(sideKeepingRatio(was, { ...was, width: 200 }, 'middle-right')).toEqual({ x: 0, y: 75, width: 200, height: 150, rotation: 0 });
    expect(sideKeepingRatio(was, { ...was, y: 150, height: 150 }, 'top-center')).toEqual({ x: 100, y: 150, width: 200, height: 150, rotation: 0 });
    const turned = sideKeepingRatio({ ...was, rotation: Math.PI / 2 }, { ...was, width: 200, rotation: Math.PI / 2 }, 'middle-left');
    close(turned.x, -75, 6);
    close(turned.y, 0, 6);
    expect(turned.height).toBe(150);
    // A corner is Konva's own.
    expect(sideKeepingRatio(was, { ...was, width: 200 }, 'top-left')).toEqual({ ...was, width: 200 });
  });
});

describe('what the canvas draws while cropping', () => {
  it('is the very list without a crop under way, and the one item at its live box and crop with one', () => {
    const seen: DrawContext[] = [];
    const items: CanvasItem[] = [
      { id: 'a', label: 'Picture', ...plain, crop: WHOLE, draw: (context) => { seen.push(context); return null; } },
      { id: 'b', label: 'Sticky', ...plain },
    ];
    expect(withCropLive(items, null)).toBe(items);
    const live = { id: 'a', geometry: { ...plain, width: 360 }, crop: { x: 0, y: 0, width: 0.9, height: 1 }, active: true };
    const shown = withCropLive(items, live);
    expect(shown[1]).toBe(items[1]);
    expect(shown[0]).toMatchObject({ id: 'a', width: 360, crop: live.crop });
    const context = { width: 360, height: 300, colours: { ink: '#000000', paper: '#FFFFFF', raised: '#EEEEEE' }, zoom: 1, inView: true };
    void shown[0]?.draw?.(context);
    expect(seen[0]).toMatchObject({ crop: live.crop });
    expect(seen[0]?.cutAway).toBeUndefined();
    // The part being cut is drawn past the box, in the item's `beyond` (which the handles never hold), reaching as far as
    // the whole picture does.
    expect(shown[0]?.beyond?.bounds).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    void shown[0]?.beyond?.draw({ ...context, rotation: 0 });
    expect(seen[1]).toMatchObject({ crop: live.crop, cutAway: true });
    // Released, with its write on the way: no cut part, just the live box.
    expect(withCropLive(items, { ...live, active: false })[0]?.beyond).toBeUndefined();
  });
});

describe('the one picture a crop acts on', () => {
  const items: CanvasItem[] = [
    { id: 'p', label: 'Picture', ...plain, crop: WHOLE },
    { id: 'r', label: 'Rectangle', ...plain },
    { id: 'l', label: 'Locked picture', ...plain, crop: WHOLE, locked: true },
  ];
  it('is a picture picked by itself, never with anything else (a connector included), never locked', () => {
    expect(soleCropItem(['p'], items)?.id).toBe('p');
    expect(soleCropItem(['p', 'connector-1'], items)).toBeUndefined();
    expect(soleCropItem(['p', 'r'], items)).toBeUndefined();
    expect(soleCropItem(['r'], items)).toBeUndefined();
    expect(soleCropItem(['l'], items)).toBeUndefined();
    expect(soleCropItem([], items)).toBeUndefined();
  });

  it('never keeps less than 1% of the picture, however small the least size on screen', () => {
    // A 4000-wide picture shown 400 wide: 1% is 4 units, more than a least size of 1.
    const big = cropDrag(plain, WHOLE, 'middle-right', { x: -1000, y: 0 }, { min: 1, keepRatio: false });
    expect(big.crop.width).toBe(0.01);
    expect(big.geometry.width).toBe(4);
  });

  it('reaches as far as a turned whole picture does', () => {
    const turned = wholeBounds({ x: 0, y: 0, width: 100, height: 100, rotation: 90 }, { x: 0.5, y: 0, width: 0.5, height: 1 });
    // A 200 by 100 picture keeping its right half, turned a quarter: it reaches from the box up by 100.
    expect(turned.width).toBeCloseTo(100, 6);
    expect(turned.height).toBeCloseTo(200, 6);
    expect(turned.y).toBeCloseTo(-100, 6);
  });
});
