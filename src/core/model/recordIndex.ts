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

/** Part of a type's records: the ones a reader depends on, where it reads only some (a plan's north among its items). */
export interface RecordsPart {
  type: SbdRecord['type'];
  counts: (record: SbdRecord) => boolean;
}

interface Unchanged {
  lists: readonly (readonly SbdRecord[])[];
  token: object;
}

// The last token given under each key, held weakly: the records objects that read it hold it, so a closed project's
// records are never kept alive from here.
const lastUnchanged = new Map<string, WeakRef<Unchanged>>();
let unchangedCompared = 0;

/** How many times a records object's lists have been compared with the last ones: for tests (once per records object and key). */
export const unchangedComparisons = (): number => unchangedCompared;

const sameRecords = (a: readonly SbdRecord[], b: readonly SbdRecord[]): boolean => a.length === b.length && a.every((record, i) => record === b[i]);

/**
 * A token for the records a reader depends on (6.26): the very same object from one records object to the next while
 * every record of `types`, and every record of `part.type` that `part.counts` picks, is the same record in the same
 * order, the Trash's too. A reading kept by this token (a WeakMap) is worked out again only when a record it could have
 * read changed, never because another record did: a light turned on a plan makes a new records object, and a sun
 * path's reading (its frames, their day and location, the room's north) stays the one it was.
 *
 * The reader names every type it reads; a type left out here is a reading that goes stale, so the list errs wide. The
 * cost per records object is one comparison of those lists with the last ones (by identity, no props read but
 * `part.counts`'s), over the type index every reader shares. One slot per key: two projects read in turn work each
 * reading out again, never wrongly.
 */
export function unchangedToken(records: Records, key: string, types: readonly SbdRecord['type'][], part?: RecordsPart): object {
  return keptFor(records, `index.unchanged:${key}`, (): Unchanged => {
    unchangedCompared += 1;
    const lists = types.map((type) => recordsOfType(records, type));
    if (part) lists.push(recordsOfType(records, part.type).filter(part.counts));
    const last = lastUnchanged.get(key)?.deref();
    if (last && last.lists.length === lists.length && last.lists.every((list, i) => sameRecords(list, lists[i] ?? NONE))) return last;
    const made: Unchanged = { lists, token: {} };
    lastUnchanged.set(key, new WeakRef(made));
    return made;
  }).token;
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
