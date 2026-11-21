import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cameraCone } from '../../src/core/model/planCamera';
import { sunReadingOf } from '../../src/core/model/sunSources';
import { windowSunsOf } from '../../src/core/model/windowSun';
import { makeTestFolder } from '../../src/core/storage/testFolder';
import { checkedAnswer, CONTACT_REFUSED } from '../src/guard';
import { readProject, type ProjectData } from '../src/project';
import { getCallSheet, getPlan, getSchedule, listGear, listLocations, listPeople, listScenes, listShots, listSuggestions, projectSummary, type ToolContext } from '../src/tools';
import { IDS, writeHarborLights } from './fixture';

// The tools against the app's own readers (7.5), and a department's "no" (Kevin, Nov 21) hiding its material from every
// tool. Called directly, on "Harbor Lights" read as the server reads it.

const folder = makeTestFolder();
let data: ProjectData;

beforeAll(async () => {
  const path = folder.path('Harbor Lights.sbd');
  await writeHarborLights(path);
  data = await readProject(path);
});

afterAll(() => {
  folder.remove();
});

/** Every tool's answer, as one text. */
function everyAnswer(context: ToolContext): string {
  return JSON.stringify([
    projectSummary(context),
    listScenes(context, { include_trashed: true }),
    listShots(context, { include_trashed: true }),
    getSchedule(context),
    getCallSheet(context, { day: '1' }),
    listPeople(context, { include_trashed: true }),
    listGear(context, { include_trashed: true }),
    listLocations(context, { include_trashed: true }),
    getPlan(context, { scene: '12', setup: '1' }),
    listSuggestions(context, { status: 'all', include_trashed: true }),
  ]);
}

/** Zones as the server has them: none looked up, a location's own typed zone alone counts. */
const noZones = () => new Map(Object.keys(data.records).map((id) => [id, null]));

describe('get_plan against the app’s own readers', () => {
  it('gives the field of view the plan draws', () => {
    const cone = cameraCone(data.records, IDS.camera);
    if (!cone || 'missing' in cone) throw new Error('The fixture’s camera has a cone.');
    const plan = getPlan({ data }, { scene: '12', setup: '1' }) as { cameras: { field_of_view: { horizontal_deg: number; frame_width_mm: number; focal_mm: number } }[] };
    const fov = plan.cameras[0]?.field_of_view;
    expect(fov?.horizontal_deg).toBeCloseTo(cone.degrees, 2);
    expect(fov?.frame_width_mm).toBeCloseTo(cone.widthMm, 2);
    expect(fov?.focal_mm).toBe(32);
  });

  it('gives the sun the plan draws, with sunrise and sunset', () => {
    const reading = sunReadingOf(data.records, IDS.sun, noZones());
    if (!reading || 'missing' in reading) throw new Error('The fixture’s sun path is drawn.');
    const plan = getPlan({ data }, { scene: '12', setup: '1' }) as { items: { id: string; sun?: { at: { bearing_deg: number; altitude_deg: number; time: string }; sunrise: string; sunset: string } }[] };
    const sun = plan.items.find((i) => i.id === IDS.sun)?.sun;
    expect(sun?.at.time).toBe('07:30');
    expect(sun?.at.bearing_deg).toBeCloseTo(reading.at?.bearing ?? NaN, 2);
    expect(sun?.at.altitude_deg).toBeCloseTo(reading.at?.altitude ?? NaN, 2);
    expect(sun?.sunrise).toBe(reading.path?.day.sunrise);
    expect(sun?.sunset).toBe(reading.path?.day.sunset);
  });

  it('gives the window hours the plan works out', () => {
    const [window] = windowSunsOf(data.records, { sceneId: IDS.scene12, setupId: IDS.setup1 }, noZones());
    const plan = getPlan({ data }, { scene: '12', setup: '1' }) as { windows: { hours: { from: string; to: string }[]; facing: { bearing_deg: number } }[] };
    expect(window?.hours?.length).toBeGreaterThan(0);
    expect(plan.windows[0]?.hours.map((h) => [h.from, h.to])).toEqual(window?.hours?.map((h) => [h.from, h.to]));
    expect(plan.windows[0]?.facing.bearing_deg).toBeCloseTo(window?.facing?.bearing ?? NaN, 2);
  });
});

describe('a department marked no (Kevin, Nov 21)', () => {
  it('hides its material from every tool, unless the reader is exempt', () => {
    expect(everyAnswer({ data })).toContain('Boom kit Sennheiser');
    const hidden = everyAnswer({ data, departments: { hidden: new Set(['sound']), exempt: false } });
    expect(hidden).not.toContain('Boom kit Sennheiser');
    expect(hidden).not.toContain(IDS.boom);
    // Another department's material is still there.
    expect(hidden).toContain('SkyPanel S60');
    // The director, or someone given permission, still reads it.
    expect(everyAnswer({ data, departments: { hidden: new Set(['sound']), exempt: true } })).toContain('Boom kit Sennheiser');
  });

  it('hides what sits under its material too, wherever a tool would show it', () => {
    const hidden = everyAnswer({ data, departments: { hidden: new Set(['grip-electric']), exempt: false } });
    // The panel is grip and electric's: gone from the gear list, the day's gear and the plan's light.
    expect(hidden).not.toContain('SkyPanel S60');
    expect(hidden).not.toContain(IDS.panel);
  });
});

describe('the server’s last check', () => {
  it('holds back an answer that would carry a contact detail', () => {
    expect(checkedAnswer(data.records, { name: 'Pier 9' })).toEqual({ ok: true, text: '{"name":"Pier 9"}' });
    expect(checkedAnswer(data.records, { note: 'call +1 555 0123' })).toEqual({ ok: false, text: CONTACT_REFUSED });
    expect(checkedAnswer(data.records, { place: 40.867712 })).toEqual({ ok: false, text: CONTACT_REFUSED });
    expect(checkedAnswer(data.records, { where: '1200 Ocean Avenue, Bayport' })).toEqual({ ok: false, text: CONTACT_REFUSED });
  });

  it('passes every tool’s answer', () => {
    expect(checkedAnswer(data.records, JSON.parse(everyAnswer({ data })) as unknown).ok).toBe(true);
  });
});
