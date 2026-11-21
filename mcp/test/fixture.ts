import { DatabaseSync } from 'node:sqlite';
import { wallBetween, wallProps } from '../../src/core/model/plan';
import type { Props, RecordType } from '../../src/core/model/record';
import { apply, type Change } from '../../src/core/ops/ops';
import { nodeDriver } from '../../src/core/storage/nodeDriver';
import { createProject } from '../../src/core/storage/project';

// Tests only: "Harbor Lights", a made-up project with made-up people (Robin Vale, Sam Ortiz), written as the app writes
// a project, with every kind of contact detail a project can hold, so the tests can search every answer for them.

/** Every contact detail the fixture holds, as the tests search for them in every answer. */
export const CONTACTS = {
  robinPhone: '+1 555 0123',
  robinEmail: 'robin.vale@example.com',
  samPhone: '+1 555 0188',
  samEmail: 'sam.ortiz@example.com',
  clientEmail: 'client.desk@example.com',
  clientPhone: '+1 555 0142',
  companyAddress: '88 Wharf Street, Bayport',
  companyPhone: '+1 555 0199',
  address: '1200 Ocean Avenue, Bayport',
  contactName: 'Dana Pierce',
  contactPhone: '+1 555 0107',
  contactEmail: 'pier.office@example.com',
  parking: 'Lot C behind 1190 Ocean Avenue',
  mapName: 'Pier 9 Ferry Terminal, Bayport',
  hospitalAddress: '45 Hill Road, Bayport',
  hospitalPhone: '+1 555 0111',
  latitude: 40.867712,
  longitude: -73.921234,
  hospitalLatitude: 40.871234,
  hospitalLongitude: -73.911234,
  ownLatitude: 40.8601234,
  ownLongitude: -73.9301234,
  photoLatitude: 40.8655512,
  photoLongitude: -73.9244412,
  photoTakenAt: '2026-10-02T07:41:09',
  personCustom: 'Agent: Lee Moss',
} as const;

/** The fixture's ids, so tests can name records. */
export const IDS = {
  pier: '10000000-0000-4000-8000-000000000001',
  flat: '10000000-0000-4000-8000-000000000002',
  robin: '10000000-0000-4000-8000-000000000003',
  sam: '10000000-0000-4000-8000-000000000004',
  mara: '10000000-0000-4000-8000-000000000005',
  scene12: '10000000-0000-4000-8000-000000000006',
  scene13: '10000000-0000-4000-8000-000000000007',
  day1: '10000000-0000-4000-8000-000000000008',
  body: '10000000-0000-4000-8000-000000000009',
  lens: '10000000-0000-4000-8000-00000000000a',
  panel: '10000000-0000-4000-8000-00000000000b',
  oldDolly: '10000000-0000-4000-8000-00000000000c',
  boom: '10000000-0000-4000-8000-00000000000d',
  setup1: '10000000-0000-4000-8000-00000000000e',
  shotA: '10000000-0000-4000-8000-00000000000f',
  shotB: '10000000-0000-4000-8000-000000000010',
  shotC: '10000000-0000-4000-8000-000000000011',
  room: '10000000-0000-4000-8000-000000000012',
  window: '10000000-0000-4000-8000-000000000013',
  north: '10000000-0000-4000-8000-000000000014',
  setupPlan: '10000000-0000-4000-8000-000000000015',
  camera: '10000000-0000-4000-8000-000000000016',
  light: '10000000-0000-4000-8000-000000000017',
  sun: '10000000-0000-4000-8000-000000000018',
  sheet: '10000000-0000-4000-8000-000000000019',
  lensSuggestion: '10000000-0000-4000-8000-00000000001a',
  phoneSuggestion: '10000000-0000-4000-8000-00000000001b',
  photo: '10000000-0000-4000-8000-00000000001c',
  wallS: '10000000-0000-4000-8000-00000000001d',
} as const;

let key = 0;
const nextKey = () => {
  key += 1;
  return `a${String(key).padStart(4, '0')}`;
};

const make = (id: string, type: RecordType, parentId: string, props: Props): Change => ({ kind: 'create', record: { id, type, parentId, sortKey: nextKey(), props } });

/** Writes "Harbor Lights" at `path` as the app would (createProject, then ops), and closes it. */
export async function writeHarborLights(path: string): Promise<void> {
  const project = await createProject(path, { driver: nodeDriver, backups: false });
  const p = project.projectId;
  const c = CONTACTS;
  const walls: [string, { x: number; y: number }, { x: number; y: number }][] = [
    ['20000000-0000-4000-8000-000000000001', { x: 0, y: 0 }, { x: 4, y: 0 }],
    ['20000000-0000-4000-8000-000000000002', { x: 4, y: 0 }, { x: 4, y: 3 }],
    [IDS.wallS, { x: 4, y: 3 }, { x: 0, y: 3 }],
    ['20000000-0000-4000-8000-000000000004', { x: 0, y: 3 }, { x: 0, y: 0 }],
  ];
  const changes: Change[] = [
    {
      kind: 'update',
      id: p,
      set: {
        title: 'Harbor Lights',
        state: 'active',
        logline: 'A ferry pilot’s last night run.',
        aspect_ratio: '2.39:1',
        currency: 'USD',
        client: { name: 'Bayport Tourism', company: 'Bayport Tourism', email: c.clientEmail, phone: c.clientPhone },
        company: { profile_id: 'p1', name: 'Harbor Pictures', address: c.companyAddress, phone: c.companyPhone, email: 'office@harbor.example', website: 'harbor.example' },
      },
    },
    make(IDS.pier, 'location', p, {
      name: 'Pier 9',
      status: 'confirmed',
      address: c.address,
      contact_name: c.contactName,
      contact_phone: c.contactPhone,
      contact_email: c.contactEmail,
      parking: c.parking,
      power: 'Two 20 A circuits in the ticket office',
      notes: `Gate opens at 5. Night guard: ${c.contactPhone}.`,
      latitude: c.latitude,
      longitude: c.longitude,
      map_name: c.mapName,
      time_zone: 'America/New_York',
      country_code: 'US',
      hospital_name: 'Bayport General',
      hospital_address: c.hospitalAddress,
      hospital_phone: c.hospitalPhone,
      hospital_latitude: c.hospitalLatitude,
      hospital_longitude: c.hospitalLongitude,
      hospital_emergency: true,
      hospital_source: 'osm',
      light_photo_id: IDS.photo,
      custom: { 'Owner cell': '+1 555 0177' },
    }),
    make(IDS.photo, 'media', IDS.pier, {
      kind: 'image',
      file: 'f'.repeat(64),
      mime: 'image/jpeg',
      width: 4032,
      height: 3024,
      source_name: 'IMG_4012.JPG',
      source_path: 'C:/Users/robin/Scout/IMG_4012.JPG',
      taken_at: c.photoTakenAt,
      gps_latitude: c.photoLatitude,
      gps_longitude: c.photoLongitude,
    }),
    make(IDS.flat, 'location', p, { name: 'Robin’s flat', status: 'tbd', address: '3B Linden Court', latitude: 40.8512345, longitude: -73.9412345, map_name: 'Linden Court' }),
    make(IDS.robin, 'person', p, {
      name: 'Robin Vale',
      role: 'dp',
      departments: ['camera', 'grip-electric'],
      title: 'Director of photography',
      phone: c.robinPhone,
      email: c.robinEmail,
      notes: 'Prefers texts.',
      contact_on_sheet: true,
    }),
    make(IDS.sam, 'person', p, { name: 'Sam Ortiz', role: 'cast', departments: ['cast'], phone: c.samPhone, email: c.samEmail, custom: { Agent: c.personCustom } }),
    make(IDS.mara, 'character', p, { name: 'MARA', cast_id: IDS.sam }),
    make(IDS.body, 'gear_item', p, { name: 'Alexa Mini LF', kind: 'camera_body', department: 'camera', camera_letter: 'A', sensor_mode: 'Open Gate', sensor_width_mm: 36.7, sensor_height_mm: 25.54 }),
    make(IDS.lens, 'gear_item', p, { name: 'Cooke S4 32', kind: 'lens', department: 'camera', focal_min_mm: 32, focal_max_mm: 32, squeeze: 1 }),
    make(IDS.panel, 'gear_item', p, { name: 'SkyPanel S60', department: 'grip-electric', watts: 450, source: 'rental', owner: 'Bayport Lighting', day_rate: 85 }),
    make(IDS.oldDolly, 'gear_item', p, { name: 'Doorway dolly', department: 'grip-electric' }),
    make(IDS.boom, 'gear_item', p, { name: 'Boom kit Sennheiser', department: 'sound' }),
    make(IDS.room, 'plan', p, { kind: 'room', name: 'Ticket office', location_id: IDS.pier, ceiling_height_m: 2.7 }),
    make(IDS.scene12, 'scene', p, { number: '12', name: 'Ticket office at dawn', int_ext: 'INT', day_night: 'DAWN', location_id: IDS.pier, character_ids: [IDS.mara], page_eighths: 11, room_id: IDS.room }),
    make(IDS.scene13, 'scene', p, { number: '13', name: 'Deck at night', int_ext: 'EXT', day_night: 'NIGHT', location_id: IDS.pier }),
    make(IDS.day1, 'shoot_day', p, { date: '2026-11-18', call_time: '06:00', wrap_time: '18:00', people_ids: [IDS.robin, IDS.sam], crew: { [IDS.robin]: 'confirmed' }, gear_ids: [IDS.body, IDS.panel] }),
    make(IDS.setup1, 'setup', IDS.scene12, { name: 'Window side' }),
    make(IDS.shotA, 'shot', IDS.scene12, { number: '12A', size: 'WS', lens_mm: 32, lens_id: IDS.lens, t_stop: 2.8, status: 'need', action: 'Mara counts the till.', shoot_day_id: IDS.day1, setup_id: IDS.setup1, gear_ids: [IDS.body] }),
    make(IDS.shotB, 'shot', IDS.scene12, { number: '12B', size: 'CU', lens_mm: 50, status: 'need', action: 'Her hands.' }),
    make(IDS.shotC, 'shot', IDS.scene13, { number: '13A', size: 'EWS', status: 'need' }),
    ...walls.map(([id, a, b]) => make(id, 'plan_item', IDS.room, wallProps(wallBetween(a, b)))),
    make(IDS.window, 'plan_item', IDS.room, { kind: 'window', wall_id: IDS.wallS, along_m: 2, width_m: 1.2, sill_height_m: 0.9, top_height_m: 2.1 }),
    make(IDS.north, 'plan_item', IDS.room, { kind: 'north', icon: 'production/north', x: 3.5, y: 0.3, width: 0.28, height: 0.6, rotation: 0 }),
    make(IDS.setupPlan, 'plan', IDS.setup1, { kind: 'setup', name: '' }),
    make(IDS.camera, 'plan_item', IDS.setupPlan, { kind: 'camera', icon: 'camera/sticks', x: 1.8, y: 2.2, width: 0.35, height: 0.4, rotation: 0, body_id: IDS.body, shot_ids: [IDS.shotA] }),
    make(IDS.light, 'plan_item', IDS.setupPlan, { kind: 'light', icon: 'lighting/led-panel', x: 0.5, y: 0.5, width: 0.6, height: 0.2, rotation: 135, gear_id: IDS.panel, height_m: 2.1 }),
    make(IDS.sun, 'plan_item', IDS.setupPlan, { kind: 'sun', icon: 'lighting/sun-path', x: 2, y: 1.5, width: 0.8, height: 0.8, rotation: 0, time: '07:30', own_latitude: c.ownLatitude, own_longitude: c.ownLongitude }),
    make(IDS.sheet, 'callsheet', IDS.day1, { notes: 'Breakfast from 05:30 at the ticket office.', safety_notes: 'Wet planks on the pier.' }),
    make(IDS.lensSuggestion, 'suggestion', p, {
      kind: 'update',
      status: 'pending',
      source: 'mcp',
      target_id: IDS.shotA,
      target_type: 'shot',
      target_label: 'SC 12 · 12A',
      author: { name: 'Robin Vale', role: 'dp' },
      note: 'Stop down for the reflection.',
      data: { props: { t_stop: 4 }, before: { t_stop: 2.8 } },
      suggested_at: '2026-11-17T10:00:00.000Z',
    }),
    make(IDS.phoneSuggestion, 'suggestion', p, {
      kind: 'update',
      status: 'pending',
      source: 'web',
      target_id: IDS.robin,
      target_type: 'person',
      target_label: 'Robin Vale',
      author: { name: 'Sam Ortiz', role: 'cast' },
      note: 'New number.',
      data: { props: { phone: '+1 555 0999', title: 'DP' }, before: { phone: c.robinPhone } },
      suggested_at: '2026-11-17T11:00:00.000Z',
    }),
  ];
  await apply(project.file, changes);
  // In the Trash: a scene with its frame, and a gear item.
  await apply(project.file, [{ kind: 'trash', id: IDS.scene13 }, { kind: 'trash', id: IDS.shotC }]);
  await apply(project.file, [{ kind: 'trash', id: IDS.oldDolly }]);
  await project.close();
}

/** Sets a file's schema version by hand, for the refusals' tests. */
export function setSchemaVersion(path: string, version: number): void {
  const db = new DatabaseSync(path);
  try {
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(version));
  } finally {
    db.close();
  }
}
