import { afterEach, describe, expect, it } from 'vitest';
import { list, setLocale, t } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import { planPlace } from './DaysTile';

// Where a plan's gear finding in Shoot days comes from (6.5): the setup's scene and the setup as setups are named
// everywhere else, its name with its number when it has one (6.5 second review, L8).

const at = '2026-11-09T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const records = Object.fromEntries(
  [
    record('p', 'project', null, {}),
    record('s1', 'scene', 'p', { number: '1' }),
    record('su1', 'setup', 's1', { name: '' }, 'a'),
    record('su2', 'setup', 's1', { name: 'Wide master' }, 'b'),
  ].map((r) => [r.id, r]),
);

afterEach(() => {
  setLocale('en');
});

describe('a plan’s finding in Shoot days', () => {
  it('names a named setup by its number and name, an unnamed one by its number', () => {
    expect(planPlace(records, 'su2')).toEqual({ scene: 'SC 01', setup: 'Setup 2 · Wide master' });
    expect(planPlace(records, 'su1')).toEqual({ scene: 'SC 01', setup: 'Setup 1' });
    const place = planPlace(records, 'su2');
    if (!place) throw new Error('no place');
    expect(t('days.planNeeds', { ...place, items: list(['Fresnel 1K']) })).toBe('SC 01: Setup 2 · Wide master’s plan needs Fresnel 1K');
    setLocale('es');
    const spanish = planPlace(records, 'su2');
    if (!spanish) throw new Error('no place');
    expect(t('days.planNeeds', { ...spanish, items: list(['Fresnel 1K']) })).toBe(`${spanish.scene}: la planta de Emplazamiento 2 · Wide master necesita Fresnel 1K`);
  });

  it('has no place for a setup outside a scene', () => {
    expect(planPlace(records, 'missing')).toBeNull();
  });
});
