import { describe, expect, it } from 'vitest';
import { planLegend } from './planLegend';
import type { Props, SbdRecord } from './record';

// A setup's legend (6.5): its items by department in layer order, repeats counted, heights and watts on each line, and
// the setup's total watts with the lights whose wattage is unknown.

const at = '2026-11-14T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));
const box = { x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0 };
const item = (id: string, plan: string, props: Props, trashedAt: string | null = null) => record(id, 'plan_item', plan, { ...box, ...props }, id, trashedAt);
const name = (icon: string) => ({ 'lighting/fresnel': 'Fresnel', 'lighting/practical': 'Practical', 'grip/flag': 'Flag', 'grip/diffusion-4x4': 'Diffusion 4×4', 'set-art/sofa': 'Sofa', 'camera/sticks': 'Sticks' })[icon] ?? icon;

const base = () =>
  recordsOf(
    record('p', 'project', null, {}),
    record('fx3', 'gear_item', 'p', { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20, camera_letter: 'A' }),
    record('k1', 'gear_item', 'p', { name: 'Fresnel 1K', watts: 1000 }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('sc', 'scene', 'p', { number: '1', room_id: 'room' }),
    record('su', 'setup', 'sc', { name: '' }),
    record('own', 'plan', 'su', { kind: 'setup', name: '' }),
    item('wall', 'room', { kind: 'wall', width: 3, height: 0.1 }),
    item('sofa', 'room', { kind: 'icon', icon: 'set-art/sofa' }),
    item('cam', 'own', { kind: 'camera', icon: 'camera/sticks', height_m: 1.5 }),
    item('l1', 'own', { kind: 'light', icon: 'lighting/fresnel', watts: 1000, height_m: 2.4 }),
    item('l2', 'own', { kind: 'light', icon: 'lighting/fresnel', gear_id: 'k1', height_m: 2.4 }),
    item('l3', 'own', { kind: 'light', icon: 'lighting/fresnel', watts: 650, name: 'Key' }),
    item('l4', 'own', { kind: 'light', icon: 'lighting/practical' }),
    item('l5', 'own', { kind: 'light', icon: 'lighting/practical' }),
    item('l6', 'own', { kind: 'light', icon: 'lighting/fresnel', watts: 2000 }, at),
    item('f1', 'own', { kind: 'flag', icon: 'grip/flag', width: 0.91, height: 0.05 }),
    item('d1', 'own', { kind: 'diffusion', icon: 'grip/diffusion-4x4', width: 1.22, height: 0.05, height_m: 2 }),
  );

describe('a setup’s legend (6.5)', () => {
  it('groups items by department in layer order, counts repeats, keeps heights and watts, and totals the watts with the unknown', () => {
    const legend = planLegend(base(), 'sc', 'su', name);
    expect(legend.groups.map((g) => g.layer)).toEqual(['camera', 'lighting', 'grip', 'set-art']);
    expect(legend.groups[0]?.lines).toEqual([{ label: 'A · Sticks', count: 1, height: { metres: 1.5 } }]);
    // Two 1,000 W fresnels at 2.40 m (one typed, one from its gear item) are one line; the named one its own; the
    // practicals with no wattage one line, unknown; the light in the Trash isn't there.
    expect(legend.groups[1]?.lines).toEqual([
      { label: 'Fresnel', count: 2, height: { metres: 2.4 }, watts: 1000 },
      { label: 'Key', count: 1, height: null, watts: 650 },
      { label: 'Practical', count: 2, height: null, watts: null },
    ]);
    // In plan order, back to front.
    expect(legend.groups[2]?.lines).toEqual([
      { label: 'Diffusion 4×4', count: 1, height: { metres: 2 } },
      { label: 'Flag', count: 1, height: null },
    ]);
    // The room's set pieces are on it; its walls are not.
    expect(legend.groups[3]?.lines).toEqual([{ label: 'Sofa', count: 1, height: null }]);
    expect(legend.watts).toEqual({ lights: 5, known: 2650, unknown: 2 });
  });

  it('follows a gear item’s watts live, and leaves out a trashed gear item’s', () => {
    const records = base();
    const trashed = { ...records, k1: { ...(records.k1 as SbdRecord), trashedAt: at } };
    expect(planLegend(trashed, 'sc', 'su', name).watts).toEqual({ lights: 5, known: 1650, unknown: 3 });
  });

  it('reads a camera’s height from its shown frame when the frame has one', () => {
    const records = {
      ...base(),
      shot: record('shot', 'shot', 'sc', { number: '1A', setup_id: 'su', height: 'eye' }),
      cam: item('cam', 'own', { kind: 'camera', icon: 'camera/sticks', height_m: 1.5, shot_ids: ['shot'] }),
    };
    expect(planLegend(records, 'sc', 'su', name).groups[0]?.lines[0]?.height).toEqual({ frame: 'eye' });
  });

  it('is empty for a setup with no items, and says no watts', () => {
    const empty = recordsOf(record('p', 'project', null, {}), record('sc', 'scene', 'p', { number: '1' }), record('su', 'setup', 'sc', { name: '' }));
    expect(planLegend(empty, 'sc', 'su', name)).toEqual({ groups: [], watts: { lights: 0, known: 0, unknown: 0 } });
  });
});
