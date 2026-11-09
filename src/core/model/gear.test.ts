import { describe, expect, it } from 'vitest';
import {
  currencyChange,
  gearDepartmentChange,
  gearQuantityChange,
  gearRateChange,
  gearSourceChange,
  gearTextChange,
  newGearItem,
  trashGearItem,
} from '../../features/gear/gearEdits';
import { setLocale } from '../i18n';
import { currencyDigits, gearFields, moneyLabel, projectCurrency, projectGear } from './gear';
import { trashedRoots } from '../ops/ops';
import type { Props, SbdRecord } from './record';

// The gear catalogue (3.9a): items read safely, listed by department then name, priced in the project's currency;
// and the edits the Gear tile makes.

const at = '2026-11-09T10:00:00.000Z';
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

const base = () =>
  recordsOf(
    record('p', 'project', null, { currency: 'EUR' }),
    record('slider', 'gear_item', 'p', { name: 'Slider', department: 'grip-electric', quantity: 1, source: 'owned' }),
    record('fx3', 'gear_item', 'p', { name: 'FX3 package', department: 'camera', quantity: 2, source: 'rental', owner: 'Abel Cine', day_rate: 350 }),
    record('boom', 'gear_item', 'p', { name: 'Boom kit' }),
    record('arri', 'gear_item', 'p', { name: 'Alexa' }, 'arri', at),
  );

describe('the gear catalogue', () => {
  it('reads an item safely: at least one, owned when unset, a rate only when it is one', () => {
    expect(gearFields({}).source).toBe('owned');
    // A source another version wrote reads as neither, never as Owned.
    expect(gearFields({ name: 'X', quantity: 0, source: 'loan', day_rate: -5, department: 'boom-op' })).toEqual({
      name: 'X',
      department: null,
      quantity: 1,
      source: null,
      owner: '',
      dayRate: null,
      notes: '',
    });
  });

  it('lists the live items by department in the call sheet’s order, those with none last', () => {
    expect(projectGear(base(), 'p').map((g) => g.record.id)).toEqual(['fx3', 'slider', 'boom']);
  });

  it('prices in the project’s currency, as the language writes it', () => {
    setLocale('en');
    expect(projectCurrency(base().p?.props)).toBe('EUR');
    expect(projectCurrency({ currency: 'dollars' })).toBe('USD');
    // As the computer's region writes it in English, so the expectation asks Intl the same way.
    expect(moneyLabel(350, 'USD')).toBe(new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(350));
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
  });
});

describe('the Gear tile’s edits', () => {
  it('make a new item, one and owned, after the others', () => {
    expect(newGearItem(base(), 'p', 'n').record.props).toEqual({ name: '', quantity: 1, source: 'owned' });
  });

  it('change a field only to a valid value', () => {
    const records = base();
    expect(gearTextChange(records, 'fx3', 'owner', 'Keslow')).toEqual([{ kind: 'update', id: 'fx3', set: { owner: 'Keslow' } }]);
    expect(gearDepartmentChange(records, 'boom', 'sound')).toEqual([{ kind: 'update', id: 'boom', set: { department: 'sound' } }]);
    expect(gearDepartmentChange(records, 'boom', 'boom-op')).toEqual([]);
    expect(gearDepartmentChange(records, 'fx3', null)).toEqual([{ kind: 'update', id: 'fx3', unset: ['department'] }]);
    expect(gearQuantityChange(records, 'fx3', 3)).toEqual([{ kind: 'update', id: 'fx3', set: { quantity: 3 } }]);
    expect(gearQuantityChange(records, 'fx3', 0)).toEqual([]);
    expect(gearSourceChange(records, 'boom', 'rental')).toEqual([{ kind: 'update', id: 'boom', set: { source: 'rental' } }]);
    expect(gearSourceChange(records, 'boom', 'owned')).toEqual([]);
    // Kept to the cent; none takes it off.
    expect(gearRateChange(records, 'fx3', 349.994)).toEqual([{ kind: 'update', id: 'fx3', set: { day_rate: 349.99 } }]);
    expect(gearRateChange(records, 'fx3', 349.999)).toEqual([]);
    expect(gearRateChange(records, 'fx3', 99.5)).toEqual([{ kind: 'update', id: 'fx3', set: { day_rate: 99.5 } }]);
    expect(gearRateChange(records, 'fx3', null)).toEqual([{ kind: 'update', id: 'fx3', unset: ['day_rate'] }]);
    expect(gearRateChange(records, 'fx3', -1)).toEqual([]);
    expect(gearRateChange(records, 'boom', 1.005)).toEqual([{ kind: 'update', id: 'boom', set: { day_rate: 1.01 } }]);
    expect(gearRateChange(records, 'boom', 349.995)).toEqual([{ kind: 'update', id: 'boom', set: { day_rate: 350 } }]);
    expect(gearRateChange(records, 'boom', 0.285)).toEqual([{ kind: 'update', id: 'boom', set: { day_rate: 0.29 } }]);
    // A currency without cents keeps whole amounts, so a day's total adds up as written.
    expect(gearRateChange(records, 'boom', 350.5, 0)).toEqual([{ kind: 'update', id: 'boom', set: { day_rate: 351 } }]);
    // A source another version wrote is changed only by picking one.
    const loan = { ...records, boom: { ...(records.boom as SbdRecord), props: { source: 'loan' } } };
    expect(gearSourceChange(loan, 'boom', 'owned')).toEqual([{ kind: 'update', id: 'boom', set: { source: 'owned' } }]);
    expect(gearTextChange(records, 'arri', 'name', 'Mini')).toEqual([]);
  });

  it('send an item to the Trash, where Empty Trash finds it, and set the project’s currency', () => {
    const records = base();
    expect(trashGearItem(records, 'fx3')).toEqual([{ kind: 'trash', id: 'fx3' }]);
    expect(trashedRoots(Object.values(records))).toEqual(['arri']);
    expect(trashGearItem(records, 'arri')).toEqual([]);
    expect(currencyChange(records, 'p', 'MXN')).toEqual([{ kind: 'update', id: 'p', set: { currency: 'MXN' } }]);
    expect(currencyChange(records, 'p', 'pesos')).toEqual([]);
  });
});
