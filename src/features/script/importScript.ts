import type { Props, SbdRecord } from '../../core/model/record';
import { sceneFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Script, ScriptScene } from '../../core/script/script';
import { locations } from '../storyboard/board';

// From a parsed script to the project (1.17): a scene shell for every scene the board doesn't have yet, with its
// location and speaking characters found or created along the way, all in one op group so one undo takes the import
// back. The preview shows this plan before anything is written.

type Records = Readonly<Record<string, SbdRecord>>;

export interface PlannedScene {
  scene: ScriptScene;
  /** The number it gets: the script's own, or the next whole number when the script prints none. */
  number: string;
  /** Already in the project (a scene with this number, live or in the Trash): left as it is. */
  exists: boolean;
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

/** What an import of this script would do to the project, for the preview and for `importChanges`. */
export function planImport(records: Records, projectId: string, script: Script): ImportPlan {
  const scenesNow = Object.values(records).filter((r) => r.type === 'scene' && r.parentId === projectId);
  const taken = new Set(scenesNow.map((r) => sceneFields(r.props).number.toUpperCase()).filter((n) => n !== ''));
  // Scenes the script doesn't number follow the highest whole number so far, in the project or the script.
  let highest = Math.max(0, ...[...taken].map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n)));
  const planned: PlannedScene[] = [];
  const numbered = new Set<string>();
  for (const scene of script.scenes) {
    let number = scene.number?.toUpperCase() ?? '';
    if (number === '' || numbered.has(number)) {
      do highest += 1;
      while (taken.has(String(highest)) || numbered.has(String(highest)));
      number = String(highest);
    } else {
      const whole = parseInt(number, 10);
      if (Number.isFinite(whole)) highest = Math.max(highest, whole);
    }
    numbered.add(number);
    planned.push({ scene, number, exists: taken.has(number) });
  }

  const sort = (names: Iterable<string>) => [...names].sort((a, b) => a.localeCompare(b));
  const split = (wanted: Map<string, string>, have: Map<string, { id: string; name: string }>) => ({
    created: sort([...wanted].filter(([k]) => !have.has(k)).map(([, name]) => name)),
    linked: sort([...wanted].filter(([k]) => have.has(k)).map(([k, name]) => have.get(k)?.name ?? name)),
  });
  const importing = planned.filter((p) => !p.exists).map((p) => p.scene);
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
    const made = create('location', { name }, placeKey);
    placeKey = made.sortKey;
    placeIds.set(key(name), made.id);
  }
  let personKey = lastKey('character');
  for (const name of plan.characters.created) personKey = create('character', { name }, personKey).sortKey;

  let sceneKey = lastKey('scene');
  for (const { scene, number, exists } of plan.scenes) {
    if (exists) continue;
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
