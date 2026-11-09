import { isDepartment } from '../../core/model/department';
import { gearFields, MAX_QUANTITY } from '../../core/model/gear';
import type { SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the Gear tile makes (3.9a): an item made, one field changed, one to the Trash, the project's currency.
// Each is one op group, so one ⌘Z.

type Records = Readonly<Record<string, SbdRecord>>;

const liveItem = (records: Records, id: string): SbdRecord | null => {
  const item = records[id];
  return item?.type === 'gear_item' && item.trashedAt === null ? item : null;
};

/** A new item after the project's others (in the Trash too, so a restored one never shares a key): one, owned. */
export function newGearItem(records: Records, projectId: string, id: string = crypto.randomUUID()): Extract<Change, { kind: 'create' }> {
  const last = Object.values(records)
    .filter((r) => r.type === 'gear_item' && r.parentId === projectId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  return { kind: 'create', record: { id, type: 'gear_item', parentId: projectId, sortKey: keyBetween(last, null), props: { name: '', quantity: 1, source: 'owned' } } };
}

/** A text field (name, owner, notes); nothing when it's already that, or something other than text is there. */
export function gearTextChange(records: Records, id: string, prop: 'name' | 'owner' | 'notes', value: string): Change[] {
  const item = liveItem(records, id);
  if (!item) return [];
  const stored = item.props[prop];
  if (stored !== undefined && typeof stored !== 'string') return [];
  return (stored ?? '') === value ? [] : [{ kind: 'update', id, set: { [prop]: value } }];
}

/** Its department, or none. */
export function gearDepartmentChange(records: Records, id: string, department: string | null): Change[] {
  const item = liveItem(records, id);
  if (!item || (department !== null && !isDepartment(department))) return [];
  const current = isDepartment(item.props.department) ? item.props.department : null;
  if (current === department) return [];
  return department === null ? [{ kind: 'update', id, unset: ['department'] }] : [{ kind: 'update', id, set: { department } }];
}

/** How many: a whole number from 1 to 999. */
export function gearQuantityChange(records: Records, id: string, quantity: number): Change[] {
  const item = liveItem(records, id);
  if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || item.props.quantity === quantity) return [];
  return [{ kind: 'update', id, set: { quantity } }];
}

/** Owned or rented; one this version can't read is changed only when the person picks either. */
export function gearSourceChange(records: Records, id: string, source: 'owned' | 'rental'): Change[] {
  const item = liveItem(records, id);
  if (!item || gearFields(item.props).source === source) return [];
  return [{ kind: 'update', id, set: { source } }];
}

/** Its day rate, kept to the currency's smallest unit (`digits` decimals: 2 for cents, 0 for yen), or none with null. */
export function gearRateChange(records: Records, id: string, rate: number | null, digits = 2): Change[] {
  const item = liveItem(records, id);
  if (!item || (rate !== null && (!Number.isFinite(rate) || rate < 0))) return [];
  const unit = 10 ** digits;
  // Scaled, then read to 15 significant digits before rounding, so 1.005 or 349.995 (each a hair under in binary)
  // round up as written.
  const cents = rate === null ? null : Math.round(Number((rate * unit).toPrecision(15))) / unit;
  const current = typeof item.props.day_rate === 'number' ? item.props.day_rate : null;
  if (current === cents) return [];
  return cents === null ? [{ kind: 'update', id, unset: ['day_rate'] }] : [{ kind: 'update', id, set: { day_rate: cents } }];
}

/** An item to the Trash. */
export function trashGearItem(records: Records, id: string): Change[] {
  return liveItem(records, id) ? [{ kind: 'trash', id }] : [];
}

/** The project's currency for every price: a three-letter code. */
export function currencyChange(records: Records, projectId: string, currency: string): Change[] {
  const project = records[projectId];
  if (!project || !/^[A-Z]{3}$/.test(currency) || project.props.currency === currency) return [];
  return [{ kind: 'update', id: projectId, set: { currency } }];
}
