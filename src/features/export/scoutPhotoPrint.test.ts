import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { startRoomChanges } from '../../core/model/plan';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { placeIconChanges } from '../birdseye/plan/planItems';
import { showAllLayers } from '../birdseye/plan/layersStore';
import { fontMeasure, planPages, type PlanPrintOptions } from './planPages';
import { PRINT_COLOURS, printZoom } from './planRender';

// A setup's plan on paper with the sun shown at the light reference photo's time (6.27 round 3, review probe 3): the
// page prints what the plan shows, so the mark's words ("Photo Nov 3, 16:42 · Quay") are in the sun path's drawing on
// the page, worked out at the page's own zoom, as planPrint.test.ts reads Rise and Set there. The place is made up: a
// point in the open Atlantic.

const font = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));
const measure = await fontMeasure({ sans: font('InterTight-Regular'), sansBold: font('InterTight-Bold'), mono: font('JetBrainsMono-Regular'), monoBold: font('JetBrainsMono-Bold') });

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  showAllLayers();
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const apply = (changes: Change[]) => store.getState().apply(changes);

const options: () => PlanPrintOptions = () => ({ paper: 'a4', unit: 'metres', underlay: true, grid: true, title: 'Bey County', now: new Date('2026-11-17T12:00:00Z'), zones: new Map(), measure });

/** Every word a drawing holds. */
function wordsOf(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => wordsOf(n));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') return wordsOf((el.type as (p: unknown) => ReactNode)(el.props));
  return [...(typeof el.props.text === 'string' ? [el.props.text] : []), ...wordsOf(el.props.children as ReactNode)];
}

describe('a plan on paper with the sun at the light reference photo’s time (6.27 round 3)', () => {
  it('prints the mark’s words with the photo’s date and the place used, and none with the switch off', async () => {
    const p = project.projectId;
    const sceneId = crypto.randomUUID();
    const setupId = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: 'quay', type: 'location', parentId: p, sortKey: 'a', props: { name: 'Quay', latitude: 12.51, longitude: -45.25, map_name: '12.51000, -45.25000', time_zone: 'Etc/GMT+3', light_photo_id: 'dusk' } } },
      { kind: 'create', record: { id: 'dusk', type: 'media', parentId: 'quay', sortKey: 'a', props: { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, source_name: 'quay-dusk.jpg', taken_at: '2026-11-03T16:42:07' } } },
      { kind: 'create', record: { id: sceneId, type: 'scene', parentId: p, sortKey: '1', props: { number: '1', name: 'Quay', int_ext: 'EXT', day_night: 'DAY', location_id: 'quay' } } },
      { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
      // No shoot day: scouting before a schedule.
      { kind: 'create', record: { id: 'f1', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId } } },
    ]);
    await apply(startRoomChanges(records(), p, sceneId));
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'production/north', { x: -3, y: -2 }));
    const sunId = crypto.randomUUID();
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'lighting/sun-path', { x: 0, y: 0 }, sunId));
    const printedWords = () => {
      const [page] = planPages(records(), p, [{ sceneId, setupId }], options());
      const area = page?.plan;
      const item = area?.items.find((i) => i.id === sunId);
      if (!area || !item?.beyond) return [];
      return wordsOf(item.beyond.draw({ width: item.width, height: item.height, rotation: item.rotation, colours: PRINT_COLOURS, zoom: printZoom(area.pointsPerUnit), inView: true, present: true, print: true }));
    };
    // Off: as before, with no day the sun says what it lacks, and nothing of the photo.
    expect(printedWords().some((w) => w.startsWith('Photo'))).toBe(false);
    await apply([{ kind: 'update', id: sunId, set: { at_photo: true } }]);
    const words = printedWords();
    // The words are drawn at the page's zoom (the print is not wordless), wrapped as on screen.
    expect(words.some((w) => w.startsWith('Rise'))).toBe(true);
    expect(words.map((w) => w.replace('\n', ' · '))).toContain('Photo Nov 3, 16:42 · Quay');
  });
});
