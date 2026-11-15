import { describe, expect, it } from 'vitest';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { ICON_BOXES } from './iconBoxes';
import { FREE_RESIZE, ICON_SIZES, iconSize, iconUse, isSymbolSize, symbolSize, TOOL_ICONS } from './iconSizes';

// The library's default sizes (6.3): every icon this milestone places has one, and no other icon does.

describe('the icon size table', () => {
  it('covers every placeable icon and no other', () => {
    const placeable = PLAN_ICONS.filter((icon) => iconUse(icon.id) === 'place').map((icon) => icon.id);
    expect(Object.keys(ICON_SIZES).sort()).toEqual([...placeable].sort());
    // 6.3's 29, 6.4's nine cameras, 6.5's ten lights and six flags and frames, 6.6's north and sun path, and 6.7's five
    // cast icons (the walk path is a picture, drawn by the plan).
    expect(placeable).toHaveLength(61);
    for (const id of placeable) {
      const size = iconSize(id);
      expect(size?.width).toBeGreaterThan(0);
      expect(size?.depth).toBeGreaterThan(0);
    }
  });

  it('holds the brief’s sizes, in metres, width by depth', () => {
    expect(ICON_SIZES['set-art/sofa']).toEqual({ width: 2, depth: 0.9 });
    expect(ICON_SIZES['set-art/table']).toEqual({ width: 1.5, depth: 0.8 });
    // A symbol (6.6 review): its longer side as stated, the other in its drawing's proportions (24 by 19).
    expect(ICON_SIZES['grip/c-stand']).toEqual({ width: 0.9, depth: 0.71 });
    expect(ICON_SIZES['production/basecamp']).toEqual({ width: 6, depth: 3 });
    expect(ICON_SIZES['production/snap-point']).toEqual({ width: 0.2, depth: 0.2 });
  });

  it('makes wall, door and window the tools, and leaves what comes later unplaced', () => {
    expect(Object.keys(TOOL_ICONS).sort()).toEqual(['set-art/door', 'set-art/wall', 'set-art/window']);
    for (const id of ['production/measure']) {
      expect(iconUse(id)).toBe('coming');
      expect(iconSize(id)).toBeNull();
    }
    expect(iconUse('set-art/wall')).toBe('tool');
    // 6.4: the cameras are placed; the field of view stays the cone's picture, drawn by each camera, never an item.
    // 6.5: the lights, flags and frames are placed; 6.6: north and the sun path; 6.7: the cast group; the measure comes later.
    expect(PLAN_ICONS.filter((icon) => iconUse(icon.id) === 'coming')).toHaveLength(1);
    expect(iconUse('camera/field-of-view')).toBe('shown');
    expect(iconSize('camera/field-of-view')).toBeNull();
  });

  it('places every camera icon at the brief’s size (6.4)', () => {
    expect(ICON_SIZES['camera/camera']).toEqual({ width: 0.35, depth: 0.4 });
    expect(ICON_SIZES['camera/sticks']).toEqual({ width: 1, depth: 1 });
    expect(ICON_SIZES['camera/dolly-track']).toEqual({ width: 1, depth: 3 });
    expect(ICON_SIZES['camera/slider']).toEqual({ width: 1.2, depth: 0.3 });
    expect(ICON_SIZES['camera/jib-crane']).toEqual({ width: 1.5, depth: 4 });
    expect(ICON_SIZES['camera/gimbal']).toEqual({ width: 0.5, depth: 0.5 });
    expect(ICON_SIZES['camera/handheld']).toEqual({ width: 0.32, depth: 0.6 });
    expect(ICON_SIZES['camera/steadicam']).toEqual({ width: 0.65, depth: 0.7 });
    expect(ICON_SIZES['camera/drone']).toEqual({ width: 0.6, depth: 0.6 });
    for (const icon of PLAN_ICONS.filter((i) => i.group === 'camera' && i.id !== 'camera/field-of-view')) expect(iconUse(icon.id)).toBe('place');
  });

  it('places every light, flag and frame at the brief’s size, and keeps the beam a picture (6.5)', () => {
    expect(ICON_SIZES['lighting/fresnel']).toEqual({ width: 0.31, depth: 0.4 });
    expect(ICON_SIZES['lighting/led-panel']).toEqual({ width: 0.7, depth: 0.54 });
    expect(ICON_SIZES['lighting/tube']).toEqual({ width: 1.2, depth: 0.18 });
    expect(ICON_SIZES['lighting/cob-softbox']).toEqual({ width: 0.9, depth: 0.9 });
    expect(ICON_SIZES['lighting/hmi-par']).toEqual({ width: 0.6, depth: 0.44 });
    expect(ICON_SIZES['lighting/china-ball']).toEqual({ width: 0.6, depth: 0.6 });
    expect(ICON_SIZES['lighting/practical']).toEqual({ width: 0.3, depth: 0.3 });
    expect(ICON_SIZES['lighting/spacelight']).toEqual({ width: 0.8, depth: 0.8 });
    expect(ICON_SIZES['lighting/rgb-gel']).toEqual({ width: 0.4, depth: 0.4 });
    expect(ICON_SIZES['lighting/window-light']).toEqual({ width: 1.2, depth: 0.92 });
    expect(ICON_SIZES['grip/flag']).toEqual({ width: 0.91, depth: 0.05 });
    expect(ICON_SIZES['grip/floppy']).toEqual({ width: 1.22, depth: 0.05 });
    expect(ICON_SIZES['grip/neg-fill']).toEqual({ width: 1.22, depth: 0.05 });
    expect(ICON_SIZES['grip/diffusion-4x4']).toEqual({ width: 1.22, depth: 0.05 });
    expect(ICON_SIZES['grip/bounce']).toEqual({ width: 1.22, depth: 0.05 });
    expect(ICON_SIZES['grip/overhead-8x8']).toEqual({ width: 2.44, depth: 2.44 });
    expect(iconUse('lighting/beam-cone')).toBe('shown');
    expect(iconSize('lighting/beam-cone')).toBeNull();
  });

  it('places north and the sun path at the brief’s sizes (6.6)', () => {
    // North's tall arrow (14 by 30): 0.6 m its longer side, never drawn fat.
    expect(ICON_SIZES['production/north']).toEqual({ width: 0.28, depth: 0.6 });
    expect(ICON_SIZES['lighting/sun-path']).toEqual({ width: 0.8, depth: 0.8 });
    expect(iconUse('production/north')).toBe('place');
    expect(iconUse('lighting/sun-path')).toBe('place');
  });

  it('lets a zone and a note resize freely, and only those', () => {
    expect([...FREE_RESIZE].sort()).toEqual(['production/note', 'production/zone']);
  });
});

/** The icons the 6.6 review names as symbols: drawn in their own proportions, the size given their longer side. */
function symbolByRule(id: string): boolean {
  const [group = ''] = id.split('/');
  if (group === 'camera') return !['camera/dolly-track', 'camera/slider', 'camera/jib-crane'].includes(id);
  if (group === 'lighting' || group === 'cast' || group === 'sound') return true;
  return ['grip/c-stand', 'grip/combo-stand', 'grip/sandbag', 'grip/apple-box', 'production/first-aid', 'production/hazard', 'production/snap-point', 'production/north'].includes(id);
}

describe('symbols keep their drawing’s proportions (6.6 review)', () => {
  it('states every symbol by its longer side and every footprint by its width and depth, as the review lists them', () => {
    for (const id of Object.keys(ICON_SIZES)) expect(isSymbolSize(id), id).toBe(symbolByRule(id));
    // Footprints keep their stated width by depth.
    expect(ICON_SIZES['camera/dolly-track']).toEqual({ width: 1, depth: 3 });
    expect(ICON_SIZES['camera/jib-crane']).toEqual({ width: 1.5, depth: 4 });
    expect(ICON_SIZES['grip/flag']).toEqual({ width: 0.91, depth: 0.05 });
    expect(ICON_SIZES['production/parking']).toEqual({ width: 2.5, depth: 5 });
  });

  it('gives each symbol its ink box’s aspect, to the centimetre, its longer side as stated', () => {
    for (const [id, size] of Object.entries(ICON_SIZES)) {
      if (!isSymbolSize(id)) continue;
      const box = ICON_BOXES[id];
      if (!box) throw new Error(`no ink box for ${id}`);
      const longer = Math.max(size.width, size.depth);
      const shorter = Math.min(size.width, size.depth);
      // The longer side on the drawing's longer side.
      expect(size.width >= size.depth, id).toBe(box.width >= box.height);
      const aspect = Math.min(box.width, box.height) / Math.max(box.width, box.height);
      expect(Math.abs(shorter - longer * aspect), id).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it('works a symbol out from its side alone; a square drawing stays square', () => {
    expect(symbolSize('production/north', 0.6)).toEqual({ width: 0.28, depth: 0.6 });
    expect(symbolSize('production/north', 1.2)).toEqual({ width: 0.56, depth: 1.2 });
    expect(symbolSize('lighting/sun-path', 0.8)).toEqual({ width: 0.8, depth: 0.8 });
    expect(symbolSize('no/such-icon', 0.5)).toEqual({ width: 0.5, depth: 0.5 });
  });
});

describe('the cast group’s sizes (6.7)', () => {
  it('places every cast icon as a symbol at its stated side, the walk path never', () => {
    expect(ICON_SIZES['cast/cast-mark']).toEqual({ width: 0.5, depth: 0.5 });
    expect(ICON_SIZES['cast/next-position']).toEqual({ width: 0.5, depth: 0.5 });
    // Symbols keep their drawing's proportions (16 by 15; 25 by 12; 22 by 19).
    expect(ICON_SIZES['cast/tape-mark']).toEqual({ width: 0.3, depth: 0.28 });
    expect(ICON_SIZES['cast/eyeline']).toEqual({ width: 1.5, depth: 0.72 });
    expect(ICON_SIZES['cast/background']).toEqual({ width: 0.5, depth: 0.43 });
    expect(iconUse('cast/walk-path')).toBe('shown');
    expect(iconSize('cast/walk-path')).toBeNull();
  });
});
