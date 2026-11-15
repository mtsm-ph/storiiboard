import { describe, expect, it } from 'vitest';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { FREE_RESIZE, ICON_SIZES, iconSize, iconUse, TOOL_ICONS } from './iconSizes';

// The library's default sizes (6.3): every icon this milestone places has one, and no other icon does.

describe('the icon size table', () => {
  it('covers every placeable icon and no other', () => {
    const placeable = PLAN_ICONS.filter((icon) => iconUse(icon.id) === 'place').map((icon) => icon.id);
    expect(Object.keys(ICON_SIZES).sort()).toEqual([...placeable].sort());
    expect(placeable).toHaveLength(29);
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
    for (const id of ['camera/camera', 'lighting/fresnel', 'cast/cast-mark', 'grip/flag', 'grip/neg-fill', 'production/north', 'production/measure']) {
      expect(iconUse(id)).toBe('coming');
      expect(iconSize(id)).toBeNull();
    }
    expect(iconUse('set-art/wall')).toBe('tool');
    // Every icon is one of the three.
    expect(PLAN_ICONS.filter((icon) => iconUse(icon.id) === 'coming')).toHaveLength(36);
  });

  it('lets a zone and a note resize freely, and only those', () => {
    expect([...FREE_RESIZE].sort()).toEqual(['production/note', 'production/zone']);
  });
});
