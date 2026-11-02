import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_ICON_GROUPS, PLAN_ICONS } from './planIcons';

const index = readFileSync(new URL('./INDEX.md', import.meta.url), 'utf8');
const rows = [...index.matchAll(/^\| ([a-z-]+) \| (.+?) \| ([a-z-]+\/[a-z0-9-]+)\.svg \|$/gm)].map((m) => ({
  group: m[1],
  label: m[2],
  id: m[3],
}));

describe('plan icon manifest', () => {
  it('has all 68 icons from the kit index', () => {
    expect(rows).toHaveLength(68);
    expect(PLAN_ICONS.map((icon) => icon.id).sort()).toEqual(rows.map((row) => row.id).sort());
  });

  it('matches each icon to its department and name', () => {
    for (const row of rows) {
      const icon = PLAN_ICONS.find((i) => i.id === row.id);
      expect(icon?.group).toBe(row.group);
      expect(icon?.label).toBe(row.label);
    }
  });

  it('keeps department order', () => {
    const order = PLAN_ICONS.map((icon) => PLAN_ICON_GROUPS.indexOf(icon.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
