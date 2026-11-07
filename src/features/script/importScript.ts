import type { Props, SbdRecord } from '../../core/model/record';
import { sceneNumberBetween } from '../../core/model/shotNumbers';
import { isSceneNumber, sceneFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Script, ScriptScene } from '../../core/script/script';
import { compareSceneNumbers, locations, trashedLocationNamed } from '../storyboard/board';
import { t } from '../../core/i18n';

// From a parsed script to the project (1.17): a scene shell for every scene the board doesn't have yet, with its
// location and speaking characters found or created along the way, all in one op group so one undo takes the import
// back. The preview shows this plan before anything is written.

type Records = Readonly<Record<string, SbdRecord>>;

/**
 * What happens to a script's scene:
 * - `new`: imported;
 * - `same`: the board has this scene already (its number, INT/EXT and place), left as it is;
 * - `taken`: the board has a different scene with this number, so it's left out rather than renumbered off the slate;
 * - `trashed`: a scene with this number is in the Trash; restoring it would clash, so this one is left out.
 */
export type PlannedStatus = 'new' | 'same' | 'taken' | 'trashed';

export interface PlannedScene {
  scene: ScriptScene;
  /** The number it gets: the script's own, or for one the script doesn't number, the one the script would give it. */
  number: string;
  status: PlannedStatus;
  /** Why its number isn't the one printed, when it isn't. */
  note: string | null;
}

export interface ImportPlan {
  title: string | null;
  scenes: PlannedScene[];
  /** Places the import creates, and those it links to because the project has them already (by name, any case). */
  locations: { created: string[]; linked: string[] };
  characters: { created: string[]; linked: string[] };
}

const key = (name: string) => name.trim().toLowerCase();

function liveNames(records: Records, projectId: string, type: 'location' | 'character'): Map<string, { id: string; name: string }> {
  const found =
    type === 'location'
      ? locations(records, projectId)
      : Object.values(records)
          .filter((r) => r.type === 'character' && r.parentId === projectId && r.trashedAt === null)
          .map((r) => ({ id: r.id, name: typeof r.props.name === 'string' ? r.props.name : '' }))
          .filter((c) => c.name !== '');
  return new Map(found.map((entry) => [key(entry.name), entry]));
}

/** The location a scene points at: only a heading with INT or EXT names a place (a forced `FLASHBACK` doesn't). */
const placeOf = (scene: ScriptScene) => (scene.intExt !== null && scene.location.trim() !== '' ? scene.location.trim() : null);

/** A scene as the board would match it: INT/EXT and the place, whatever the case. */
const sceneKey = (intExt: string | null, name: string) => `${intExt ?? ''}|${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;

/**
 * A printed number as the slate has it: a space or dash between its digits and letters goes (`1-a` and `4 A` are 1A
 * and 4A), but not between two numbers (`12-14`, scenes combined, isn't 1214). Null for one that can't be a number.
 */
function slateNumber(printed: string | null): string | null {
  const tidy = (printed ?? '').toUpperCase().trim().replace(/(\d)[\s-]+([A-Z])/g, '$1$2').replace(/([A-Z])[\s-]+(\d)/g, '$1$2');
  return isSceneNumber(tidy) ? tidy : null;
}

/** What an import of this script would do to the project, for the preview and for `importChanges`. */
export function planImport(records: Records, projectId: string, script: Script): ImportPlan {
  const board = new Map<string, { key: string; trashed: boolean }>();
  for (const record of Object.values(records)) {
    if (record.type !== 'scene' || record.parentId !== projectId) continue;
    const fields = sceneFields(record.props);
    if (fields.number !== '') board.set(fields.number.toUpperCase(), { key: sceneKey(fields.intExt, fields.name), trashed: record.trashedAt !== null });
  }
  // The script's own numbers are kept, exactly; one it prints twice keeps the first.
  const printed = script.scenes.map((scene) => slateNumber(scene.number));
  const first = new Map<string, number>();
  printed.forEach((number, index) => {
    if (number !== null && !first.has(number)) first.set(number, index);
  });
  const scriptNumbers = [...first.keys()];
  // The board's live scenes by heading, in board number order, leaving out the numbers the script prints itself: what
  // an unnumbered scene can be matched to, so a draft imported again is found wherever its scenes were numbered.
  const byHeading = new Map<string, string[]>();
  for (const [number, scene] of [...board].sort((a, b) => compareSceneNumbers(a[0], b[0]))) {
    if (scene.trashed || first.has(number)) continue;
    byHeading.set(scene.key, [...(byHeading.get(scene.key) ?? []), number]);
  }
  const claim = (key: string, number: string) => {
    byHeading.set(key, (byHeading.get(key) ?? []).filter((n) => n !== number));
  };

  const planned: PlannedScene[] = [];
  script.scenes.forEach((scene, index) => {
    const own = printed[index] ?? null;
    const key = sceneKey(scene.intExt, sceneName(scene));
    let number: string;
    let note: string | null = null;
    let status: PlannedStatus;
    if (own !== null && first.get(own) === index) {
      // A printed number is the slate's: kept, and never moved to make room.
      number = own;
      const there = board.get(number);
      status = !there ? 'new' : there.trashed ? 'trashed' : there.key === key ? 'same' : 'taken';
    } else {
      // Numbered as the script would be: after the scene before it and before the next number it prints (1, then 1A
      // before a printed 2), so importing the same draft again finds its scenes on the board.
      const before = planned.at(-1)?.number ?? null;
      const after = printed.slice(index + 1).find((n): n is string => n !== null && first.has(n)) ?? null;
      const scriptTaken = [...scriptNumbers, ...planned.map((p) => p.number)];
      number = sceneNumberBetween(before, after, scriptTaken);
      const there = board.get(number);
      const match = byHeading.get(key)?.[0];
      if (there && !there.trashed && there.key === key) {
        status = 'same';
        claim(key, number);
      } else if (match !== undefined) {
        // On the board already under another number (an import numbered round hand-made scenes): that one.
        number = match;
        status = 'same';
        claim(key, match);
      } else {
        // No slate number to keep: a number the board has for another scene (or in the Trash) is passed over.
        if (there) number = sceneNumberBetween(before, after, [...scriptTaken, ...board.keys()]);
        status = 'new';
      }
      if (scene.number !== null) {
        note = own === null ? t('script.notASceneNumber', { number: scene.number }) : t('script.printedTwice', { number: own });
      }
    }
    planned.push({ scene, number, status, note });
  });

  const sort = (names: Iterable<string>) => [...names].sort((a, b) => a.localeCompare(b));
  const split = (wanted: Map<string, string>, have: Map<string, { id: string; name: string }>) => ({
    created: sort([...wanted].filter(([k]) => !have.has(k)).map(([, name]) => name)),
    linked: sort([...wanted].filter(([k]) => have.has(k)).map(([k, name]) => have.get(k)?.name ?? name)),
  });
  const importing = planned.filter((p) => p.status === 'new').map((p) => p.scene);
  const places = new Map<string, string>();
  const people = new Map<string, string>();
  for (const scene of importing) {
    const place = placeOf(scene);
    if (place && !places.has(key(place))) places.set(key(place), place);
    for (const name of scene.characters) if (!people.has(key(name))) people.set(key(name), name);
  }
  return {
    title: script.title,
    scenes: planned,
    locations: split(places, liveNames(records, projectId, 'location')),
    characters: split(people, liveNames(records, projectId, 'character')),
  };
}

/** The scene's name as the board shows it after INT/EXT: its place, and a time of day the board has no value for. */
function sceneName(scene: ScriptScene): string {
  const place = scene.location.trim();
  // Stored as the scene's name, so it's the script's own words, never the app's language.
  return scene.otherTime ? `${place} — ${scene.otherTime}` : place;
}

/** The one op group an import writes: new locations and characters, then the scenes after the board's last. */
export function importChanges(records: Records, projectId: string, plan: ImportPlan): Change[] {
  const changes: Change[] = [];
  const lastKey = (type: SbdRecord['type']) =>
    Object.values(records)
      .filter((r) => r.type === type && r.parentId === projectId)
      .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  const create = (type: SbdRecord['type'], props: Props, after: string | null) => {
    const id = crypto.randomUUID();
    const sortKey = keyBetween(after, null);
    changes.push({ kind: 'create', record: { id, type, parentId: projectId, sortKey, props } });
    return { id, sortKey };
  };

  const placeIds = new Map([...liveNames(records, projectId, 'location')].map(([k, v]) => [k, v.id]));
  let placeKey = lastKey('location');
  for (const name of plan.locations.created) {
    // One in the Trash by that name comes back, its address and contact with it, rather than a second (3.3).
    const trashed = trashedLocationNamed(records, projectId, name);
    if (trashed) {
      changes.push({ kind: 'restore', id: trashed.id });
      placeIds.set(key(name), trashed.id);
      continue;
    }
    const made = create('location', { name }, placeKey);
    placeKey = made.sortKey;
    placeIds.set(key(name), made.id);
  }
  let personKey = lastKey('character');
  for (const name of plan.characters.created) personKey = create('character', { name }, personKey).sortKey;

  let sceneKey = lastKey('scene');
  for (const { scene, number, status } of plan.scenes) {
    if (status !== 'new') continue;
    const place = placeOf(scene);
    const props: Props = {
      number,
      name: sceneName(scene),
      page_eighths: scene.eighths,
      characters: [...scene.characters],
      ...(scene.intExt ? { int_ext: scene.intExt } : {}),
      ...(scene.dayNight ? { day_night: scene.dayNight } : {}),
      ...(place ? { location_id: placeIds.get(key(place)) ?? null } : {}),
    };
    sceneKey = create('scene', props, sceneKey).sortKey;
  }
  return changes;
}
