import { formatMoney, labels } from '../i18n';
import { DEPARTMENTS, isDepartment, type Department } from './department';
import type { JsonValue, Props, SbdRecord } from './record';

// The project's gear (3.9, docs/PHASE3_DECISIONS.md 7): a catalogue of `gear_item` records under the project, each
// named once (a package, a lens set, a camera body) with how many, whose it is (owned, or from a rental house), what it
// costs a day when rented, and the department it belongs to. Shoot days and frames pick from it (3.9b), so the check
// "a frame needs gear not on its day's list" compares one item with itself. Prices are in the project's currency.

export const GEAR_SOURCES = ['owned', 'rental'] as const;
export type GearSource = (typeof GEAR_SOURCES)[number];

export const GEAR_SOURCE_LABEL: Readonly<Record<GearSource, string>> = labels({
  owned: 'gear.source.owned',
  rental: 'gear.source.rental',
});

export const MAX_QUANTITY = 999;

export interface GearFields {
  name: string;
  /** The department it belongs to (camera, grip & electric, sound…); null for none. */
  department: Department | null;
  /** At least 1. */
  quantity: number;
  /** Null for a value this version doesn't know (a newer one's): shown as neither, never written over unasked. */
  source: GearSource | null;
  /** Who owns it, or the rental house. */
  owner: string;
  /** What it costs a day, in the project's currency; null when there's no rate. */
  dayRate: number | null;
  notes: string;
}

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

export function gearFields(props: Props): GearFields {
  const quantity = props.quantity;
  const rate = props.day_rate;
  return {
    name: text(props.name),
    department: isDepartment(props.department) ? props.department : null,
    quantity: typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : 1,
    source: props.source === undefined || props.source === 'owned' ? 'owned' : props.source === 'rental' ? 'rental' : null,
    owner: text(props.owner),
    dayRate: typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 ? rate : null,
    notes: text(props.notes),
  };
}

/** By name, an unnamed one last. */
const byName = (a: string, b: string): number => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b));

/** The project's live gear: by department in the call sheet's order (none last), then by name. */
export function projectGear(records: Readonly<Record<string, SbdRecord>>, projectId: string): { record: SbdRecord; fields: GearFields }[] {
  const rank = (d: Department | null) => (d === null ? DEPARTMENTS.length : DEPARTMENTS.indexOf(d));
  return Object.values(records)
    .filter((r) => r.type === 'gear_item' && r.parentId === projectId && r.trashedAt === null)
    .map((record) => ({ record, fields: gearFields(record.props) }))
    .sort((a, b) => rank(a.fields.department) - rank(b.fields.department) || byName(a.fields.name, b.fields.name));
}

/** Currencies offered for a project's prices; a code stored outside the list still reads, as it was set. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'AUD', 'BRL', 'COP', 'ARS', 'CLP', 'PEN', 'JPY'] as const;
export const DEFAULT_CURRENCY = 'USD';

/** The project's currency (`currency` on the project): a three-letter code, else USD. */
export function projectCurrency(projectProps: Props | undefined): string {
  const code = projectProps?.currency;
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
}

/** How many decimals a currency's amounts have: 2 for most, 0 for the yen or the Chilean peso. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * "$350.00": an amount as the app's language writes the currency. In English, as the computer's region writes it
 * (dates do the same: src/core/i18n/index.ts), so a crew in London reads £ and day-month.
 */
export const moneyLabel = (amount: number, currency: string): string => formatMoney(amount, currency);
