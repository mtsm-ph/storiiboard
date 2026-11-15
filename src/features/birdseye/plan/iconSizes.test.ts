import { describe, expect, it } from 'vitest';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { FREE_RESIZE, ICON_SIZES, iconSize, iconUse, TOOL_ICONS } from './iconSizes';

// The library's default sizes (6.3): every icon this milestone places has one, and no other icon does.

describe('the icon size table', () => {
  it('covers every placeable icon and no other', () => {
    const placeable = PLAN_ICONS.filter((icon) => iconUse(icon.id) === 'place').map((icon) => icon.id);
    expect(Object.keys(ICON_SIZES).sort()).toEqual([...placeable].sort());
    // 6.3's 29 and 6.4's nine cameras.
    expect(placeable).toHaveLength(38);
    for (const id of placeable) {
      const size = iconSize(id);
      expect(size?.width).toBeGreaterThan(0);
      expect(size?.depth).toBeGreaterThan(0);
    }
  });

  it('holds the brief’s sizes, in metres, width by depth', () => {
    expect(ICON_SIZES['set-art/sofa']).toEqual({ width: 2, depth: 0.9 });
    expect(ICON_SIZES['set-art/table']).toEqual({ width: 1.5, depth: 0.8 });
    expect(ICON_SIZES['grip/c-stand']).toEqual({ width: 0.9, depth: 0.9 });
    expect(ICON_SIZES['production/basecamp']).toEqual({ width: 6, depth: 3 });
    expect(ICON_SIZES['production/snap-point']).toEqual({ width: 0.2, depth: 0.2 });
  });

  it('makes wall, door and window the tools, and leaves what comes later unplaced', () => {
    expect(Object.keys(TOOL_ICONS).sort()).toEqual(['set-art/door', 'set-art/wall', 'set-art/window']);
    for (const id of ['lighting/fresnel', 'cast/cast-mark', 'grip/flag', 'grip/neg-fill', 'production/north', 'production/measure']) {
      expect(iconUse(id)).toBe('coming');
      expect(iconSize(id)).toBeNull();
    }
    expect(iconUse('set-art/wall')).toBe('tool');
    // 6.4: the cameras are placed; the field of view stays the cone's picture, drawn by each camera, never an item.
    expect(PLAN_ICONS.filter((icon) => iconUse(icon.id) === 'coming')).toHaveLength(26);
    expect(iconUse('camera/field-of-view')).toBe('shown');
    expect(iconSize('camera/field-of-view')).toBeNull();
  });

  it('places every camera icon at the brief’s size (6.4)', () => {
    expect(ICON_SIZES['camera/camera']).toEqual({ width: 0.4, depth: 0.4 });
    expect(ICON_SIZES['camera/sticks']).toEqual({ width: 1, depth: 1 });
    expect(ICON_SIZES['camera/dolly-track']).toEqual({ width: 1, depth: 3 });
    expect(ICON_SIZES['camera/slider']).toEqual({ width: 1.2, depth: 0.3 });
    expect(ICON_SIZES['camera/jib-crane']).toEqual({ width: 1.5, depth: 4 });
    expect(ICON_SIZES['camera/gimbal']).toEqual({ width: 0.5, depth: 0.5 });
    expect(ICON_SIZES['camera/handheld']).toEqual({ width: 0.6, depth: 0.6 });
    expect(ICON_SIZES['camera/steadicam']).toEqual({ width: 0.7, depth: 0.7 });
    expect(ICON_SIZES['camera/drone']).toEqual({ width: 0.6, depth: 0.6 });
    for (const icon of PLAN_ICONS.filter((i) => i.group === 'camera' && i.id !== 'camera/field-of-view')) expect(iconUse(icon.id)).toBe('place');
  });

  it('lets a zone and a note resize freely, and only those', () => {
    expect([...FREE_RESIZE].sort()).toEqual(['production/note', 'production/zone']);
  });
});
