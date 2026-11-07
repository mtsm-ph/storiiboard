import { describe, expect, it } from 'vitest';
import { clampCrop, cropBox, cropProp, cropWindow, DEFAULT_CROP, isDefaultCrop, MAX_ZOOM, moveWindow, panCrop, readCrop, zoomCrop } from './crop';

const WIDE = 16 / 9;
const SCOPE = 2.39;

describe('framing a picture', () => {
  it('covers the frame at zoom 1, cropping the long side evenly', () => {
    // A 3:2 photo in a 2.39 frame fills the width; its height overhangs top and bottom equally.
    const box = cropBox(DEFAULT_CROP, 3 / 2, SCOPE);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo((SCOPE / 1.5) * 100);
    expect(box.left).toBeCloseTo(0);
    expect(box.top).toBeCloseTo((100 - box.height) / 2);
    // A panorama in a 16:9 frame fills the height instead.
    const wide = cropBox(DEFAULT_CROP, 3, WIDE);
    expect(wide.height).toBeCloseTo(100);
    expect(wide.left).toBeCloseTo((100 - wide.width) / 2);
  });

  it('never leaves a gap, however far the picture is moved', () => {
    const moved = panCrop(DEFAULT_CROP, -5, 5, 3 / 2, SCOPE);
    const box = cropBox(moved, 3 / 2, SCOPE);
    expect(box.left).toBeCloseTo(0);
    expect(box.top).toBeCloseTo(0);
    expect(cropBox({ x: 1, y: 1, zoom: 1 }, 3 / 2, SCOPE).top + cropBox({ x: 1, y: 1, zoom: 1 }, 3 / 2, SCOPE).height).toBeCloseTo(100);
  });

  it('follows the hand: dragging right shows more of the left of the picture', () => {
    const zoomed = zoomCrop(DEFAULT_CROP, 2, WIDE, WIDE);
    const dragged = panCrop(zoomed, 0.25, 0, WIDE, WIDE);
    expect(dragged.x).toBeCloseTo(0.375);
    expect(dragged.y).toBeCloseTo(0.5);
    expect(cropBox(dragged, WIDE, WIDE).left).toBeCloseTo(-50 + 25);
  });

  it('zooms about the same point, between 1 and the most', () => {
    const near = zoomCrop({ x: 0.3, y: 0.6, zoom: 1 }, 3, WIDE, WIDE);
    expect(near).toEqual({ x: 0.3, y: 0.6, zoom: 3 });
    expect(zoomCrop(DEFAULT_CROP, 10, WIDE, WIDE).zoom).toBe(MAX_ZOOM);
    expect(zoomCrop(DEFAULT_CROP, 0.2, WIDE, WIDE).zoom).toBe(1);
    // Zooming out pulls a far-off centre back so the picture still covers the frame.
    expect(clampCrop({ x: 0.1, y: 0.5, zoom: 1 }, WIDE, WIDE).x).toBe(0.5);
  });

  it('reads a stored crop and refuses nonsense', () => {
    expect(readCrop({ crop: { x: 0.25, y: 0.75, zoom: 2 } })).toEqual({ x: 0.25, y: 0.75, zoom: 2 });
    expect(readCrop({})).toEqual(DEFAULT_CROP);
    expect(readCrop({ crop: 'wide' })).toEqual(DEFAULT_CROP);
    expect(readCrop({ crop: { x: 9, y: -1, zoom: 99 } })).toEqual({ x: 1, y: 0, zoom: MAX_ZOOM });
    expect(isDefaultCrop(readCrop({}))).toBe(true);
    expect(cropProp({ x: 0.123456, y: 0.5, zoom: 1.98765 })).toEqual({ x: 0.123, y: 0.5, zoom: 1.988 });
  });
});

describe('the frame’s window over a take (2.6)', () => {
  it('is the part of the picture the frame shows: a 2.39 frame over a 16:9 take, full width, centred', () => {
    const box = cropWindow(DEFAULT_CROP, 16 / 9, 2.39);
    expect(box.left).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo((100 * (16 / 9)) / 2.39);
    expect(box.top).toBeCloseTo((100 - box.height) / 2);
    // A 4:5 frame over the same take: full height, a slice of its width.
    const tall = cropWindow(DEFAULT_CROP, 16 / 9, 4 / 5);
    expect([tall.top, tall.height]).toEqual([expect.closeTo(0), expect.closeTo(100)]);
    expect(tall.width).toBeCloseTo((100 * (4 / 5)) / (16 / 9));
  });

  it('agrees with where the picture sits in the frame, and zooms about its centre', () => {
    const crop = { x: 0.3, y: 0.6, zoom: 2 };
    const picture = cropBox(crop, 16 / 9, 2.39);
    const window = cropWindow(crop, 16 / 9, 2.39);
    // The window's width is the frame's share of the picture; its left edge, where the frame's left edge falls.
    expect(window.width).toBeCloseTo(100 * (100 / picture.width));
    expect(window.left).toBeCloseTo((-picture.left / picture.width) * 100);
    expect(window.left + window.width / 2).toBeCloseTo(30);
  });

  it('moves with the hand, and never leaves the picture', () => {
    const right = moveWindow(DEFAULT_CROP, 0, 0.1, 16 / 9, 2.39);
    expect(right.y).toBeCloseTo(0.6);
    // Already full width: it can't go left or right.
    expect(moveWindow(DEFAULT_CROP, 0.2, 0, 16 / 9, 2.39).x).toBeCloseTo(0.5);
    const top = cropWindow(moveWindow(DEFAULT_CROP, 0, -9, 16 / 9, 2.39), 16 / 9, 2.39);
    expect(top.top).toBeCloseTo(0);
    const zoomed = { ...DEFAULT_CROP, zoom: 2 };
    const corner = cropWindow(moveWindow(zoomed, 9, 9, 16 / 9, 2.39), 16 / 9, 2.39);
    expect(corner.left + corner.width).toBeCloseTo(100);
    expect(corner.top + corner.height).toBeCloseTo(100);
  });
});
