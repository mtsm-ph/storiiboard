import { describe, expect, it } from 'vitest';
import { drawnItems, drawReach } from './culling';
import type { CanvasItem } from './types';

// What a canvas draws (5.7, 6.4): items whose drawing meets the view and the selected ones; what an item draws past its
// box (a camera's cone) counts, so the cone stays drawn while its camera is off screen. Boards set none, and read as before.

const item = (id: string, x: number, y: number, extra: Partial<CanvasItem> = {}): CanvasItem => ({ id, label: id, x, y, width: 40, height: 40, rotation: 0, ...extra });
const view = { x: 0, y: 0, width: 400, height: 300 };

describe('drawing past the box', () => {
  it('keeps an item drawn while only its cone meets the view, and picks nothing new', () => {
    const cone = { bounds: { x: -700, y: 0, width: 760, height: 100 }, draw: () => null };
    const camera = item('cam', -500, 20, { beyond: cone });
    const plain = item('box', -500, 20);
    expect(drawReach(camera)).toEqual({ x: -700, y: 0, width: 760, height: 100 });
    expect(drawnItems([camera, plain], new Set(), view).map((i) => i.id)).toEqual(['cam']);
    // Its cone out of view too: not drawn, unless it is selected.
    const far = item('far', -2000, 20, { beyond: { bounds: { x: -2600, y: 0, width: 640, height: 40 }, draw: () => null } });
    expect(drawnItems([far], new Set(), view)).toEqual([]);
    expect(drawnItems([far], new Set(['far']), view).map((i) => i.id)).toEqual(['far']);
  });

  it('leaves an item with nothing past its box as its box', () => {
    const plain = item('box', 10, 10);
    expect(drawReach(plain)).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(drawnItems([plain], new Set(), view)).toEqual([plain]);
  });
});
