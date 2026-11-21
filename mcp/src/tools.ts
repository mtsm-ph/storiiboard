import { assistantView, suggestionFieldsLeftOut, NO_DEPARTMENT_FLAGS, viewText, withoutContacts, type DepartmentAccess } from '../../src/core/model/assistantView';
import { callSheet, callSheetIssues } from '../../src/core/model/callsheet';
import { bodyFields, frameLens, gearKind, lensFields } from '../../src/core/model/cameraGear';
import { departmentStates, departmentStatuses } from '../../src/core/model/departmentStatus';
import { gearFields, gearIdsOf, gearWatts, projectCurrency, projectGear } from '../../src/core/model/gear';
import { frameLocationId, keptHospital, locationFields, locationPhotos, mapPlace, projectLocations } from '../../src/core/model/location';
import { castOf, characterName, personFields, projectCharacters, projectPeople, sceneCharacters } from '../../src/core/model/person';
import {
  isCamera,
  isLight,
  isOpening,
  isWallFields,
  planFields,
  sceneRoom,
  shownItems,
  wallEnds,
  type ShownFields,
} from '../../src/core/model/plan';
import { itemLayer } from '../../src/core/model/planBlocking';
import { cameraBody, cameraCone, cameraFrames, cameraHeight, cameraLens } from '../../src/core/model/planCamera';
import { planHeights } from '../../src/core/model/planHeights';
import { planLegend } from '../../src/core/model/planLegend';
import { beamDirection, beamOf, lightWatts } from '../../src/core/model/planLight';
import { sceneNorth } from '../../src/core/model/planSun';
import type { JsonValue, Props, SbdRecord } from '../../src/core/model/record';
import { projectStateOf } from '../../src/core/model/project';
import { dayCrew, dayLocations, dayPeopleIds, dayScenes } from '../../src/core/model/schedule';
import { sceneSetups, frameSetup, type Setup } from '../../src/core/model/setup';
import { dayFrames, dayTotals, frameDayId, projectShootDays, setupMinutes, unscheduledFrames, type ShootDay } from '../../src/core/model/shootDay';
import { lightReferenceOf } from '../../src/core/model/scoutPhoto';
import { pagesText, projectStoryboard, sceneFields, sceneLabel, shotFields } from '../../src/core/model/storyboard';
import { reviewFlagWords, reviewSuggestion } from '../../src/core/model/suggestion';
import { sunReadingOf, type SunReadingOf } from '../../src/core/model/sunSources';
import { windowSunsOf } from '../../src/core/model/windowSun';
import type { ProjectData, Records } from './project';

// The ten read tools of 7.5 (Phase 7 decision 16, Kevin's Nov 16 additions; docs/MCP.md has each one's shape). Each
// reads the project through the assistant view (src/core/model/assistantView.ts), with the app's own readers: no
// numbering, sun, field of view or total is worked out a second way here. A tool returns fields picked one by one from
// what the view gives; values the readers work out from props the view leaves out (the sun from a location's place)
// come back as the values alone, never the props. server.ts checks every answer for contact details before it is sent.

/** A tool's refusal in words: the assistant is told this, and nothing else of the project. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolContext {
  data: ProjectData;
  /** Department flags (Kevin, Nov 21): empty until departments by file store them. */
  departments?: DepartmentAccess;
}

type Json = JsonValue;
type Obj = { [key: string]: Json };

/** A reader's plain data (strings, numbers, booleans, nulls, arrays and objects of them) as JSON. */
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

/**
 * A tool's answer as it leaves: every string in it through the view's text rule (round 2), so a string a reader hands
 * back from the full records (a cast member's character names, a field name in a flag's words) is scrubbed as a given
 * prop is. Ids and dates come through as they are.
 */
const out = (answer: Obj): Obj => viewText(answer) as Obj;

/** A short word a suggestion carries (its kind, target type, source): scrubbed and at most 64 characters. */
const word = (value: string | null): string | null => (value === null ? null : withoutContacts(value).slice(0, 64));

const text = (props: Props, key: string): string => {
  const value = props[key];
  return typeof value === 'string' ? value : '';
};

/** The zones a sun path's place would be looked up in: none here. The desktop app asks Rust (tzf-rs); this server never
 * looks anything up, so every point reads as having no zone found, and only a location's own typed zone counts. */
function noLookups(records: Records): ReadonlyMap<string, string | null> {
  return new Map(Object.keys(records).map((id) => [id, null]));
}

interface Read {
  data: ProjectData;
  /** Props given (assistantView). */
  given: Records;
  /** Every prop, same records: for the readers only. */
  scoped: Records;
  projectId: string;
}

function read(context: ToolContext, includeTrashed = false): Read {
  const view = assistantView(context.data.records, { includeTrashed, departments: context.departments ?? NO_DEPARTMENT_FLAGS });
  return { data: context.data, given: view.given, scoped: view.scoped, projectId: context.data.projectId };
}

/** A record's given props, by id; {} for none. */
const givenOf = (r: Read, id: string | null | undefined): Props => (id ? (r.given[id]?.props ?? {}) : {});

const ref = (r: Read, id: string | null | undefined): Obj | null => {
  if (!id || !r.given[id]) return null;
  return { id, name: text(givenOf(r, id), 'name') };
};

const trashed = (record: SbdRecord): Obj => (record.trashedAt === null ? {} : { trashed: true, trashed_at: record.trashedAt });

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The project's scenes in board order: live ones, and with `withTrashed` those in the Trash too. */
function boardScenes(r: Read, withTrashed: boolean): SbdRecord[] {
  return Object.values(r.scoped)
    .filter((s) => s.type === 'scene' && s.parentId === r.projectId && (withTrashed || s.trashedAt === null))
    .sort(bySortKey);
}

/** A scene by its number as on the slate ("12", "4A", "SC 04" and "04" for 4), live first. */
function sceneByNumber(r: Read, number: string, withTrashed = false): SbdRecord {
  const wanted = number.trim().replace(/^sc\s*/i, '').toUpperCase();
  const scenes = boardScenes(r, withTrashed);
  const match = (list: SbdRecord[]) =>
    list.find((s) => sceneFields(s.props).number.toUpperCase() === wanted) ??
    list.find((s) => /^\d+$/.test(wanted) && sceneFields(s.props).number === String(Number(wanted)));
  // A live scene first; one in the Trash with the same number only when no live one has it.
  const found = match(scenes.filter((s) => s.trashedAt === null)) ?? match(scenes.filter((s) => s.trashedAt !== null));
  if (!found) {
    const known = scenes.filter((s) => s.trashedAt === null).map((s) => sceneFields(s.props).number).filter((n) => n !== '');
    throw new ToolError(`There's no scene numbered "${number}". The scenes are ${known.length > 0 ? known.join(', ') : 'none yet'}.`);
  }
  return found;
}

/** A setup of a scene, by its number ("2") or its id. */
function setupOf(r: Read, scene: SbdRecord, setup: string): Setup {
  const setups = sceneSetups(r.scoped, scene.id);
  const wanted = setup.trim().replace(/^setup\s*/i, '');
  const found = setups.find((s) => s.record.id === wanted) ?? setups.find((s) => String(s.number) === wanted);
  if (!found) {
    const label = sceneFields(scene.props).number;
    throw new ToolError(
      setups.length === 0 ? `Scene ${label} has no setups.` : `Scene ${label} has no setup "${setup}". Its setups are ${setups.map((s) => String(s.number)).join(', ')}.`,
    );
  }
  return found;
}

/** A shoot day by its date (YYYY-MM-DD) or its number ("3", "Day 3"). */
function dayOf(r: Read, day: string): ShootDay {
  const days = projectShootDays(r.scoped, r.projectId);
  const wanted = day.trim().replace(/^day\s*/i, '');
  const byDate = days.filter((d) => d.fields.date === wanted);
  if (byDate.length > 1) throw new ToolError(`Days ${byDate.map((d) => String(d.number)).join(' and ')} share the date ${wanted}: ask for the day by its number.`);
  const found = byDate[0] ?? days.find((d) => /^\d+$/.test(wanted) && d.number === Number(wanted));
  if (!found) {
    throw new ToolError(
      days.length === 0
        ? 'The project has no shoot days yet.'
        : `There's no shoot day "${day}". The days are ${days.map((d) => `${String(d.number)}${d.fields.date ? ` (${d.fields.date})` : ''}`).join(', ')}.`,
    );
  }
  return found;
}

const sceneBrief = (scene: SbdRecord): Obj => {
  const fields = sceneFields(scene.props);
  return { id: scene.id, number: fields.number, label: sceneLabel(fields.number) };
};

const dayBrief = (day: ShootDay): Obj => ({ id: day.record.id, number: day.number, date: day.fields.date || null });

// -- project_summary ---------------------------------------------------------------------------------------------------

export function projectSummary(context: ToolContext): Obj {
  const r = read(context);
  const project = givenOf(r, r.projectId);
  const company = project.company;
  const scenes = boardScenes(r, false);
  const frames = Object.values(r.scoped).filter((s) => s.type === 'shot' && s.trashedAt === null && scenes.some((sc) => sc.id === s.parentId));
  const days = projectShootDays(r.scoped, r.projectId);
  const pending = Object.values(r.scoped).filter((s) => s.type === 'suggestion' && s.props.status === 'pending').length;
  const storyboard = projectStoryboard(r.scoped[r.projectId]?.props);
  return out({
    project: {
      id: r.projectId,
      file_name: r.data.name,
      title: text(project, 'title') || text(project, 'name') || r.data.name,
      state: projectStateOf(project),
      stage: text(project, 'stage') || null,
      logline: text(project, 'logline'),
      format: text(project, 'format'),
      runtime: text(project, 'runtime'),
      notes: text(project, 'notes'),
      company: typeof company === 'object' && company !== null && !Array.isArray(company) && typeof company.name === 'string' ? company.name : null,
      aspect_ratio: storyboard.aspectRatio,
      currency: projectCurrency(r.scoped[r.projectId]?.props),
      minutes_per_setup: setupMinutes(r.scoped[r.projectId]?.props),
      deliverables: Array.isArray(project.deliverables)
        ? project.deliverables.flatMap((d) => (typeof d === 'object' && d !== null && !Array.isArray(d) ? [{ text: typeof d.text === 'string' ? d.text : '', done: d.done === true }] : []))
        : [],
      schema_version: r.data.schemaVersion,
    },
    counts: {
      scenes: scenes.length,
      frames: frames.length,
      frames_need_to_shoot: frames.filter((s) => shotFields(s.props).status === 'need').length,
      setups: scenes.reduce((n, s) => n + sceneSetups(r.scoped, s.id).length, 0),
      shoot_days: days.length,
      people: projectPeople(r.scoped, r.projectId).length,
      characters: projectCharacters(r.scoped, r.projectId).length,
      locations: projectLocations(r.scoped, r.projectId).length,
      gear_items: projectGear(r.scoped, r.projectId).length,
      suggestions_pending: pending,
    },
    shoot_days: days.map(dayBrief),
    left_out: LEFT_OUT_WORDS,
  });
}

/** What every answer leaves out, said once per summary so the assistant never guesses at it. */
export const LEFT_OUT_WORDS =
  'Contact details are never returned: phone numbers, email addresses, street addresses, parking notes, places on the map ' +
  "and coordinates, a scout photo's place and time, the client's and the company's contact. Text people type (notes, " +
  'action, dialogue) is given as typed, with phone numbers, emails, coordinates and map links taken out where they can ' +
  'be recognised. Trashed items only when asked ' +
  '(include_trashed). No stored file (picture, PDF, script) is returned.';

// -- list_scenes -------------------------------------------------------------------------------------------------------

export function listScenes(context: ToolContext, args: { include_trashed?: boolean }): Obj {
  const withTrashed = args.include_trashed === true;
  const r = read(context, withTrashed);
  return out({
    scenes: boardScenes(r, withTrashed).map((scene): Obj => {
      const fields = sceneFields(scene.props);
      const given = givenOf(r, scene.id);
      const frames = Object.values(r.scoped).filter((s) => s.type === 'shot' && s.parentId === scene.id && s.trashedAt === null);
      return {
        ...sceneBrief(scene),
        name: text(given, 'name') || text(given, 'heading'),
        int_ext: fields.intExt,
        day_night: fields.dayNight,
        location: ref(r, fields.locationId),
        pages: fields.pageEighths === null ? null : pagesText(fields.pageEighths),
        page_eighths: fields.pageEighths,
        numbers_locked: fields.numbersLocked,
        characters: sceneCharacters(r.scoped, scene).map((c) => ({ id: c.id, name: text(givenOf(r, c.id), 'name').trim() })),
        frames: frames.length,
        setups: sceneSetups(r.scoped, scene.id).map((s) => ({ id: s.record.id, number: s.number, name: text(givenOf(r, s.record.id), 'name').trim() })),
        ...trashed(scene),
      };
    }),
  });
}

// -- list_shots --------------------------------------------------------------------------------------------------------

export function listShots(context: ToolContext, args: { scene?: string; shoot_day?: string; include_trashed?: boolean }): Obj {
  const withTrashed = args.include_trashed === true;
  const r = read(context, withTrashed);
  const scenes = args.scene === undefined ? boardScenes(r, withTrashed) : [sceneByNumber(r, args.scene, withTrashed)];
  const day = args.shoot_day === undefined ? null : dayOf(r, args.shoot_day);
  const days = projectShootDays(r.scoped, r.projectId);
  const shots = scenes.flatMap((scene) =>
    Object.values(r.scoped)
      .filter((s) => s.type === 'shot' && s.parentId === scene.id && (withTrashed || s.trashedAt === null))
      .sort(bySortKey)
      .map((shot) => ({ scene, shot })),
  );
  return out({
    ...(day ? { shoot_day: dayBrief(day) } : {}),
    shots: shots
      .filter(({ shot }) => !day || frameDayId(r.scoped, shot) === day.record.id)
      .map(({ scene, shot }): Obj => {
        const fields = shotFields(shot.props);
        const given = givenOf(r, shot.id);
        const lens = frameLens(r.scoped, shot);
        const setup = frameSetup(r.scoped, shot);
        const dayId = frameDayId(r.scoped, shot);
        const onDay = dayId === null ? undefined : days.find((d) => d.record.id === dayId);
        return {
          id: shot.id,
          number: fields.number,
          scene: sceneBrief(scene),
          title: text(given, 'title'),
          size: fields.size,
          lens_mm: fields.lensMm,
          lens: lens ? { id: lens.record.id, name: text(givenOf(r, lens.record.id), 'name'), squeeze: lens.fields.squeeze } : null,
          t_stop: fields.tStop,
          support: text(given, 'support'),
          height: text(given, 'height'),
          move: text(given, 'move'),
          status: fields.status,
          action: text(given, 'action'),
          dialogue: text(given, 'dialogue'),
          location: ref(r, frameLocationId(r.scoped, shot)),
          shoot_day: onDay ? dayBrief(onDay) : null,
          setup: setup ? { id: setup.record.id, number: setup.number, name: text(givenOf(r, setup.record.id), 'name').trim() } : null,
          gear: gearIdsOf(shot.props).flatMap((id) => {
            const item = ref(r, id);
            return item && r.scoped[id]?.trashedAt === null ? [item] : [];
          }),
          departments: departmentStates(departmentStatuses(shot.props), r.data.seen[shot.id] ?? []).map((d) => ({ department: d.department, states: d.states })),
          has_picture: fields.mediaId !== null && r.scoped[fields.mediaId] !== undefined,
          ...trashed(shot),
          // A frame still on the board's list but in a scene that is in the Trash (only listed with include_trashed).
          ...(shot.trashedAt === null && scene.trashedAt !== null ? { scene_trashed: true } : {}),
        };
      }),
  });
}

// -- get_schedule ------------------------------------------------------------------------------------------------------

export function getSchedule(context: ToolContext): Obj {
  const r = read(context);
  const minutes = setupMinutes(r.scoped[r.projectId]?.props);
  const days = projectShootDays(r.scoped, r.projectId);
  const unscheduled = unscheduledFrames(r.scoped, r.projectId);
  return out({
    minutes_per_setup: minutes,
    days: days.map((day): Obj => {
      const frames = dayFrames(r.scoped, r.projectId, day.record.id);
      const totals = dayTotals(r.scoped, frames, minutes);
      // The app's own count of who is called and who confirmed (the Calendar's "1 of 3 confirmed").
      const crew = dayCrew(r.scoped, r.projectId, day.record);
      return {
        ...dayBrief(day),
        call_time: day.fields.callTime || null,
        wrap_time: day.fields.wrapTime || null,
        notes: text(givenOf(r, day.record.id), 'notes'),
        totals: { frames: totals.frames, setups: totals.setups, minutes: totals.minutes },
        scenes: dayScenes(r.scoped, r.projectId, day.record.id).map(sceneBrief),
        frames: frames.map(({ shot }) => ({ id: shot.id, number: shotFields(shot.props).number, status: shotFields(shot.props).status })),
        locations: dayLocations(r.scoped, r.projectId, day.record.id).map((l) => ({ id: l.record.id, name: text(givenOf(r, l.record.id), 'name'), status: l.status })),
        people: { called: crew.people, confirmed: crew.confirmed, chosen: dayPeopleIds(day.record.props) !== null },
        gear: gearIdsOf(day.record.props).flatMap((id) => {
          const item = ref(r, id);
          return item && r.scoped[id]?.trashedAt === null ? [item] : [];
        }),
      };
    }),
    unscheduled_need_to_shoot: unscheduled.map(({ scene, shot }) => ({ id: shot.id, number: shotFields(shot.props).number, scene: sceneFields(scene.props).number })),
  });
}

// -- get_call_sheet ----------------------------------------------------------------------------------------------------

export function getCallSheet(context: ToolContext, args: { day: string }): Obj {
  const r = read(context);
  const day = dayOf(r, args.day);
  // No zone is looked up here (see noLookups). The app's sheet reads a location with no zone typed in this computer's
  // zone; that zone is this computer's, not the project's, so it never goes out (round 2): such a location says
  // `zone: null, missing: 'noZone'` and has no sun times, which would be in the guessed zone.
  const sheet = callSheet(r.scoped, r.projectId, day.record.id, undefined, noLookups(r.scoped));
  if (!sheet) throw new ToolError(`There's no shoot day "${args.day}".`);
  const name = (record: SbdRecord) => text(givenOf(r, record.id), 'name');
  const zoneOut = (zone: { zone: string; source: string } | null): Obj | null =>
    zone === null ? null : zone.source === 'computer' ? { zone: null, missing: 'noZone' } : { zone: zone.zone, from: zone.source };
  return out({
    day: { ...dayBrief(sheet.day), of: sheet.dayCount, call_time: sheet.day.fields.callTime || null, wrap_time: sheet.day.fields.wrapTime || null },
    title: text(givenOf(r, r.projectId), 'title') || r.data.name,
    times_in: zoneOut(sheet.timesIn),
    nothing_left_to_shoot: sheet.nothingLeft,
    scenes: sheet.scenes.map((s) => ({
      ...sceneBrief(s.record),
      name: text(givenOf(r, s.record.id), 'name') || text(givenOf(r, s.record.id), 'heading'),
      int_ext: s.fields.intExt,
      day_night: s.fields.dayNight,
      pages: s.fields.pageEighths === null ? null : pagesText(s.fields.pageEighths),
      locations: s.locationIds.map((id) => ref(r, id)),
      frames: s.frames,
      characters: s.characters.map((c) => ({ name: text(givenOf(r, c.record.id), 'name').trim(), cast: c.cast ? name(c.cast.record) : null, on_day: c.onDay })),
    })),
    cast: sheet.cast.map((c) => ({ id: c.person.record.id, name: name(c.person.record), characters: c.characters, call: c.times.call || null, hmu_ready: c.times.hmuReady || null, on_set: c.times.onSet || null })),
    crew: sheet.crew.map((g) => ({
      department: g.department,
      call: g.call,
      people: g.people.map((p) => ({ id: p.record.id, name: name(p.record), title: text(givenOf(r, p.record.id), 'title'), role: p.fields.role, call: p.call || null })),
    })),
    people_chosen: sheet.peopleChosen,
    locations: sheet.locations.map((l) => {
      const given = givenOf(r, l.record.id);
      const hospital = l.safety.hospital;
      return {
        id: l.record.id,
        name: text(given, 'name'),
        status: l.fields.status,
        power: text(given, 'power'),
        notes: text(given, 'notes'),
        has_place: l.place !== null,
        time_zone: zoneOut(l.zone),
        sun:
          l.sun && l.zone && l.zone.source !== 'computer'
            ? { state: l.sun.state, sunrise: l.sun.sunrise || null, sunset: l.sun.sunset || null, golden_hour: json(l.sun.golden), blue_hour: json(l.sun.blue) }
            : null,
        safety: {
          country_code: l.safety.countryCode || null,
          emergency_numbers: l.safety.numbers.map((n) => ({ kind: n.kind, number: n.number })),
          // The hospital's name and how far it is, to a whole kilometre (round 2: a finer distance narrows where the
          // location is): its address and phone are contact details.
          hospital: hospital ? { name: text(given, 'hospital_name'), emergency_department: hospital.emergency, distance_km: hospital.distanceKm === null ? null : Math.round(hospital.distanceKm) } : null,
        },
      };
    }),
    notes: { general: text(givenOf(r, sheet.notes.record?.id), 'notes'), safety: text(givenOf(r, sheet.notes.record?.id), 'safety_notes') },
    issued: callSheetIssues(r.scoped, day.record.id).map((i) => ({ version: i.version, issued_at: i.issuedAt || null })),
    left_out:
      'Phone numbers and email addresses (even where the sheet prints them), addresses, parking, the map and its coordinates, the forecast (it is fetched by the app, never by these tools). ' +
      "A location with no time zone typed has no sun times here: the app would read it in this computer's zone.",
  });
}

// -- list_people -------------------------------------------------------------------------------------------------------

export function listPeople(context: ToolContext, args: { include_trashed?: boolean }): Obj {
  const withTrashed = args.include_trashed === true;
  const r = read(context, withTrashed);
  const people = withTrashed
    ? Object.values(r.scoped).filter((p) => p.type === 'person' && p.parentId === r.projectId).map((record) => ({ record, fields: personFields(record.props) }))
    : projectPeople(r.scoped, r.projectId);
  const characters = Object.values(r.scoped).filter((c) => c.type === 'character' && c.parentId === r.projectId && characterName(c) !== '');
  return out({
    people: people.map(({ record, fields }): Obj => {
      const given = givenOf(r, record.id);
      return {
        id: record.id,
        name: text(given, 'name'),
        role: fields.role,
        departments: fields.departments,
        title: text(given, 'title'),
        full_view: fields.fullView,
        plays: characters.filter((c) => c.props.cast_id === record.id).map((c) => text(givenOf(r, c.id), 'name').trim()),
        ...trashed(record),
      };
    }),
    characters: characters
      .sort((a, b) => characterName(a).localeCompare(characterName(b)))
      .map((c) => {
        const cast = castOf(r.scoped, c);
        return { id: c.id, name: text(givenOf(r, c.id), 'name').trim(), cast: cast ? { id: cast.id, name: text(givenOf(r, cast.id), 'name') } : null, ...trashed(c) };
      }),
    left_out: "Each person's phone, email, notes, their own fields and whether their contact prints on call sheets.",
  });
}

// -- list_gear ---------------------------------------------------------------------------------------------------------

export function listGear(context: ToolContext, args: { include_trashed?: boolean }): Obj {
  const withTrashed = args.include_trashed === true;
  const r = read(context, withTrashed);
  const items = withTrashed
    ? Object.values(r.scoped).filter((g) => g.type === 'gear_item' && g.parentId === r.projectId).map((record) => ({ record, fields: gearFields(record.props) }))
    : projectGear(r.scoped, r.projectId);
  return out({
    currency: projectCurrency(r.scoped[r.projectId]?.props),
    gear: items.map(({ record, fields }): Obj => {
      const given = givenOf(r, record.id);
      const kind = gearKind(record.props);
      const body = kind === 'camera_body' ? bodyFields(record.props) : null;
      const lens = kind === 'lens' ? lensFields(record.props) : null;
      return {
        id: record.id,
        name: text(given, 'name'),
        kind,
        department: fields.department,
        quantity: fields.quantity,
        source: fields.source,
        owner: text(given, 'owner'),
        day_rate: fields.dayRate,
        notes: text(given, 'notes'),
        watts: gearWatts(record.props),
        ...(body
          ? { body: { letter: body.letter, sensor_mode: text(given, 'sensor_mode'), sensor_width_mm: body.sensorWidthMm, sensor_height_mm: body.sensorHeightMm, focal_lengths_full_frame_equivalent: body.focalEquivalent } }
          : {}),
        ...(lens ? { lens: { focal_min_mm: lens.range?.min ?? null, focal_max_mm: lens.range?.max ?? null, squeeze: lens.squeeze } } : {}),
        ...trashed(record),
      };
    }),
  });
}

// -- list_locations ----------------------------------------------------------------------------------------------------

export function listLocations(context: ToolContext, args: { include_trashed?: boolean }): Obj {
  const withTrashed = args.include_trashed === true;
  const r = read(context, withTrashed);
  const live = projectLocations(r.scoped, r.projectId);
  const list = withTrashed
    ? Object.values(r.scoped)
        .filter((l) => l.type === 'location' && l.parentId === r.projectId)
        .map((record) => live.find((l) => l.record.id === record.id) ?? { record, fields: locationFields(record.props), scenes: [], frames: [] })
    : live;
  return out({
    locations: list.map(({ record, fields, scenes, frames }): Obj => {
      const given = givenOf(r, record.id);
      const hospital = keptHospital(record.props);
      const reference = lightReferenceOf(r.scoped, record);
      return {
        id: record.id,
        name: text(given, 'name'),
        status: fields.status,
        power: text(given, 'power'),
        notes: text(given, 'notes'),
        time_zone: fields.time_zone || null,
        country_code: fields.country_code || null,
        has_place: mapPlace(record.props) !== null,
        pin_placed_by_hand: record.props.map_moved === true,
        hospital: hospital ? { name: text(given, 'hospital_name'), emergency_department: hospital.emergency } : null,
        scenes: scenes.map(sceneBrief),
        frames_shot_here: frames.map((f) => ({ id: f.id, number: shotFields(f.props).number })),
        photos: locationPhotos(r.scoped, record.id).length,
        light_reference: reference.kind !== 'none',
        ...trashed(record),
      };
    }),
    left_out: "Each location's address, contact name, phone and email, parking, its own fields, its place on the map and coordinates, the hospital's address, phone and place, and its photos' place and time.",
  });
}

// -- get_plan ----------------------------------------------------------------------------------------------------------

const round = (n: number, places = 4): number => {
  const f = 10 ** places;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
};

/** An item's box, metres and degrees. */
function box(fields: ShownFields): Obj {
  if (!('x' in fields)) return {};
  return { x_m: round(fields.x), y_m: round(fields.y), width_m: round(fields.width), depth_m: round(fields.height), rotation_deg: round(fields.rotation, 6) };
}

/** A sun path's reading, the place's coordinates (and a scout photo's place and time) left out. */
function sunOut(r: Read, reading: SunReadingOf | null): Obj {
  if (!reading) return { missing: 'noFrames' };
  const place = reading.place;
  const date = reading.date;
  // A scout photo's place and time are contact details (question 20): what the sun did then would say them, so a reading
  // drawn from a photo gives its sources and nothing it worked out.
  const fromPhoto = place?.source === 'photo' || date?.source === 'photo';
  const placeOut: Json = place ? { source: place.source, ...(place.source === 'own' ? {} : { location: ref(r, place.location.id) }) } : null;
  const dateOut: Json = date ? { source: date.source, ...(fromPhoto ? {} : { date: date.date }), ...(date.source === 'shootDay' ? { shoot_day: dayBrief(date.day) } : {}) } : null;
  if ('missing' in reading) return { missing: reading.missing, place: placeOut, date: dateOut };
  if (fromPhoto) {
    return { place: placeOut, date: dateOut, left_out: "Drawn at a scout photo's place and time, which count as contact details: the sun's numbers for it aren't returned." };
  }
  // To a whole degree (round 2): the sun's exact position at a known time and date says where on Earth it was drawn for.
  const at = (p: { bearing: number; altitude: number; up: boolean; time: string } | null): Json =>
    p ? { time: p.time, bearing_deg: round(p.bearing, 0), altitude_deg: round(p.altitude, 0), up: p.up } : null;
  const day = reading.path?.day ?? null;
  return {
    place: placeOut,
    date: dateOut,
    zone: { zone: reading.zone.zone, from: reading.zone.source },
    at: at(reading.at),
    solar_noon: at(reading.noon),
    sunrise: day && day.state === 'normal' ? day.sunrise : null,
    sunset: day && day.state === 'normal' ? day.sunset : null,
    day: day ? day.state : null,
    golden_hour: day ? json(day.golden) : null,
    blue_hour: day ? json(day.blue) : null,
  };
}

export function getPlan(context: ToolContext, args: { scene: string; setup?: string }): Obj {
  const r = read(context);
  const scene = sceneByNumber(r, args.scene);
  const setup = args.setup === undefined ? null : setupOf(r, scene, args.setup);
  const setupId = setup?.record.id ?? null;
  const view = { sceneId: scene.id, setupId };
  const room = sceneRoom(r.scoped, scene.id);
  const heights = room ? planHeights(r.scoped, room.id) : null;
  const items = shownItems(r.scoped, scene.id, setupId);
  const zones = noLookups(r.scoped);
  const legend = planLegend(r.scoped, scene.id, setupId, (icon) => icon);
  const north = sceneNorth(r.scoped, scene.id);
  const name = (record: SbdRecord) => text(givenOf(r, record.id), 'name').trim();

  const walls = items.flatMap(({ record, fields, level }) => {
    if (!isWallFields(fields)) return [];
    const [start, end] = wallEnds(fields);
    return [
      {
        id: record.id,
        level,
        name: name(record),
        start: { x_m: round(start.x), y_m: round(start.y) },
        end: { x_m: round(end.x), y_m: round(end.y) },
        length_m: round(fields.width),
        thickness_m: round(fields.height),
        height_m: fields.heightM,
      },
    ];
  });
  const openings = items.flatMap(({ record, fields, level }) => {
    if (!isOpening(fields)) return [];
    const h = heights?.openings.find((o) => o.id === record.id);
    return [
      {
        id: record.id,
        kind: fields.kind,
        level,
        name: name(record),
        wall_id: fields.wallId,
        along_m: round(fields.along),
        width_m: round(fields.width),
        ...(fields.kind === 'door' ? { hinge: fields.hinge, swing: fields.swing } : {}),
        height_m: fields.heightM,
        ...(fields.kind === 'window' ? { sill_m: h?.sillM ?? null, top_m: h?.topM ?? null } : {}),
      },
    ];
  });
  const cameras = items.flatMap(({ record, fields }) => {
    if (!isCamera(fields)) return [];
    const cone = cameraCone(r.scoped, record.id);
    const lens = cameraLens(r.scoped, record.id);
    const body = cameraBody(r.scoped, record);
    const height = cameraHeight(r.scoped, record.id);
    return [
      {
        id: record.id,
        name: name(record),
        icon: fields.icon,
        ...box(fields),
        letter: body?.fields.letter ?? null,
        body: body ? { id: body.record.id, name: name(body.record), is_project_default: body.isDefault } : null,
        sensor_mode: body ? { name: text(givenOf(r, body.record.id), 'sensor_mode'), width_mm: body.fields.sensorWidthMm, height_mm: body.fields.sensorHeightMm } : null,
        lens: lens ? { from: lens.from, focal_mm: lens.mm, squeeze: lens.squeeze, lens: lens.lens ? ref(r, lens.lens.record.id) : null } : null,
        on_side: fields.onSide,
        field_of_view: cone === null ? null : 'missing' in cone ? { missing: cone.missing } : { horizontal_deg: round(cone.degrees, 2), frame_width_mm: round(cone.widthMm, 2), focal_mm: cone.focalMm },
        height: height === null ? null : height.from === 'frame' ? { from: 'frame', frame_height: height.value } : { from: 'camera', metres: height.metres },
        frames: cameraFrames(r.scoped, record.id).map((shot) => ({ id: shot.id, number: shotFields(shot.props).number })),
        stops_at_walls: fields.stopAtWalls !== false,
      },
    ];
  });
  const lights = items.flatMap(({ record, fields }) => {
    if (!isLight(fields)) return [];
    const watts = lightWatts(r.scoped, record.id);
    return [
      {
        id: record.id,
        name: name(record),
        icon: fields.icon,
        ...box(fields),
        height_m: fields.heightM,
        watts: watts?.watts ?? null,
        watts_from: watts?.from ?? null,
        beam_deg: beamOf(fields),
        beam_direction_deg: round(beamDirection(fields), 6),
        gear: watts?.from === 'gear' ? ref(r, watts.gear.id) : ref(r, fields.gearId),
      },
    ];
  });
  const others = items.flatMap(({ record, fields, level }) => {
    if (isWallFields(fields) || isOpening(fields) || isCamera(fields) || isLight(fields)) return [];
    const extra: Obj = {};
    if (fields.kind === 'sun') {
      extra.time = fields.time;
      extra.sun = sunOut(r, sunReadingOf(r.scoped, record.id, zones));
    }
    if (fields.kind === 'mark') {
      extra.character = ref(r, fields.characterId);
      extra.camera_id = fields.cameraId;
    }
    if ('icon' in fields) extra.icon = fields.icon;
    if ('heightM' in fields) extra.height_m = fields.heightM;
    return [{ id: record.id, kind: fields.kind, level, layer: itemLayer(r.scoped, record), name: name(record), ...box(fields), ...extra }];
  });
  const windows = windowSunsOf(r.scoped, view, zones).map((w) => {
    const fromPhoto = w.place?.source === 'photo' || w.date?.source === 'photo';
    return {
      id: w.windowId,
      wall_id: w.wallId,
      wall: w.wall,
      // Bearings and altitudes to a whole degree, as the sun's (round 2).
      facing: w.facing ? { bearing_deg: round(w.facing.bearing, 0), point: w.facing.point } : null,
      missing: w.missing,
      zone: fromPhoto ? null : w.zone,
      hours: fromPhoto
        ? null
        : (w.hours?.map((h) => ({ from: h.from, to: h.to, ...(h.altitude ? { altitude_deg: { min: round(h.altitude.min, 0), max: round(h.altitude.max, 0) } } : {}) })) ?? null),
      ...(fromPhoto ? { left_out: "Worked out for a scout photo's place and time, which count as contact details." } : {}),
    };
  });
  return out({
    scene: sceneBrief(scene),
    setup: setup ? { id: setup.record.id, number: setup.number, name: text(givenOf(r, setup.record.id), 'name').trim() } : null,
    units: 'Lengths in metres; x to the right and y down the plan; rotations in degrees clockwise from up the plan; bearings in degrees clockwise from north.',
    room: room ? { id: room.id, name: text(givenOf(r, room.id), 'name').trim(), location: ref(r, planFields(room.props)?.locationId), ceiling_height_m: heights?.ceilingM ?? null } : null,
    north: north === null ? null : { plan_rotation_deg: round(north, 6), meaning: 'North points this many degrees clockwise from up the plan.' },
    walls,
    openings,
    cameras,
    lights,
    watts: { total_known: legend.watts.known, lights: legend.watts.lights, lights_without_watts: legend.watts.unknown },
    items: others,
    windows,
    windows_note: windows.length > 0 ? "Direct sun through each outside window, from its facing and the sun's path. Buildings and trees outside aren't known." : null,
    left_out:
      "The place's coordinates and a scout photo's place and time; the sun's and windows' bearings and altitudes are to a whole degree. " +
      'A zone is never looked up from the map here: a location needs its time zone typed for the sun to be worked out.',
  });
}

// -- list_suggestions --------------------------------------------------------------------------------------------------

export function listSuggestions(context: ToolContext, args: { status?: 'pending' | 'approved' | 'rejected' | 'all'; include_trashed?: boolean }): Obj {
  const withTrashed = args.include_trashed === true;
  const r = read(context, withTrashed);
  const wanted = args.status ?? 'pending';
  const suggestions = Object.values(r.scoped)
    .filter((s) => s.type === 'suggestion')
    .sort(bySortKey)
    .flatMap((record): Obj[] => {
      // The project's own reader of a suggestion, flags and all (7.0), on the records the assistant may see.
      const review = reviewSuggestion(r.scoped, r.projectId, record.id, r.data.slate);
      if (!review) return [];
      const s = review.suggestion;
      if (wanted !== 'all' && s.status !== wanted) return [];
      const given = givenOf(r, record.id);
      const author = given.author;
      return [
        {
          id: s.id,
          // What the suggestion says of itself is typed by whoever sent it: scrubbed and bounded (round 2).
          kind: word(s.kind ?? s.kindName),
          status: s.status,
          target: { id: s.targetId, type: word(s.targetType), label: text(given, 'target_label') },
          source: word(s.source),
          author: typeof author === 'object' && author !== null && !Array.isArray(author) ? { name: typeof author.name === 'string' ? author.name : '', role: typeof author.role === 'string' ? author.role : '' } : null,
          note: text(given, 'note'),
          suggested_at: s.suggestedAt,
          decided_by: text(given, 'decided_by') || null,
          decided_at: s.decidedAt,
          data: given.data ?? null,
          fields_left_out: suggestionFieldsLeftOut(r.data.records, record),
          flags: review.flags.map((flag) => ({ kind: flag.kind, words: reviewFlagWords(flag, s.targetType) })),
          can_apply: review.canApply,
          ...trashed(record),
        },
      ];
    });
  return out({ status: wanted, suggestions, note: 'A person applies or rejects each suggestion in the app, one by one; these tools never do.' });
}
