import type { SbdRecord } from './record';

// The records indexed once per records object (6.21): an edit must not cost a scan of every record per tile. A project's
// records run to thousands (a sketched storyboard's strokes are records), and on every edit each tile's readers asked
// for "the setups of this scene", "the items of this plan", each by a pass over all of them. Records objects are never
// changed in place (each edit makes a new one, src/app/projectStore.ts), so an index is good for as long as its records
// object lives, and a new records object is indexed anew on first use. Readers read from these with exactly the results
// and order they gave before: a type's records keep the order Object.values gives them, so a filter over them is the
// filter over all the records, less the records of other types.

type Records = Readonly<Record<string, SbdRecord>>;

const NONE: readonly SbdRecord[] = [];

const byType = new WeakMap<Records, ReadonlyMap<string, readonly SbdRecord[]>>();
let typeIndexings = 0;

/** How many times records have been indexed by type: for tests, which check it is once per records object. */
export const recordsTypeIndexed = (): number => typeIndexings;

/**
 * The records of a type, the Trash's too, in the order Object.values gives them, from one pass over the records per
 * records object. Read-only: shared by every reader of these records.
 */
export function recordsOfType(records: Records, type: SbdRecord['type']): readonly SbdRecord[] {
  let index = byType.get(records);
  if (!index) {
    typeIndexings += 1;
    const made = new Map<string, SbdRecord[]>();
    for (const record of Object.values(records)) {
      const list = made.get(record.type);
      if (list) list.push(record);
      else made.set(record.type, [record]);
    }
    index = made;
    byType.set(records, made);
  }
  return index.get(type) ?? NONE;
}

const kept = new WeakMap<Records, Map<string, unknown>>();

/**
 * A reading kept per records object and key: made on first use, the same value after. What it gives is shared, so its
 * readers never change it (a public reader whose callers might hands out a copy). Keys are prefixed by their module.
 */
export function keptFor<T>(records: Records, key: string, make: () => T): T {
  let known = kept.get(records);
  if (!known) {
    known = new Map();
    kept.set(records, known);
  }
  if (known.has(key)) return known.get(key) as T;
  const made = make();
  known.set(key, made);
  return made;
}

/** Records of a type by their parent, the Trash's too, each list in Object.values order: one pass over the type. */
export function childrenByParent(records: Records, type: SbdRecord['type']): ReadonlyMap<string, readonly SbdRecord[]> {
  return keptFor(records, `index.children:${type}`, () => {
    const made = new Map<string, SbdRecord[]>();
    for (const record of recordsOfType(records, type)) {
      if (record.parentId === null) continue;
      const list = made.get(record.parentId);
      if (list) list.push(record);
      else made.set(record.parentId, [record]);
    }
    return made;
  });
}

/** A parent's children of a type, the Trash's too, in Object.values order. Read-only. */
export const childrenOf = (records: Records, parentId: string, type: SbdRecord['type']): readonly SbdRecord[] => childrenByParent(records, type).get(parentId) ?? NONE;
