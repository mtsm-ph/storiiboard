import type { JsonValue, Props, SbdRecord } from './record';
import { labels } from '../i18n';
import { placeFrom, type Place } from '../net/places';

// A location (3.3): one place a scene is shot, named once and linked from every scene there (`scene.location_id`), so an
// address or a parking note changed here is changed for every scene and, from Phase 4, every call sheet. Its contact's
// phone and email are private, like every contact: shown where the person asks, never logged.

export const LOCATION_STATUSES = ['tbd', 'confirmed', 'cancelled'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const LOCATION_STATUS_LABEL: Readonly<Record<LocationStatus, string>> = labels({
  tbd: 'locationStatus.tbd',
  confirmed: 'locationStatus.confirmed',
  cancelled: 'locationStatus.cancelled',
});

export function isLocationStatus(value: unknown): value is LocationStatus {
  return typeof value === 'string' && (LOCATION_STATUSES as readonly string[]).includes(value);
}

/** The text fields a location's editor shows, in its order: each is a prop of the same name. */
export const LOCATION_TEXT_FIELDS = ['address', 'contact_name', 'contact_phone', 'contact_email', 'parking', 'power', 'notes'] as const;
export type LocationTextField = (typeof LOCATION_TEXT_FIELDS)[number];

export interface LocationFields {
  name: string;
  /** TBD until it's booked; a missing or odd value reads as TBD. */
  status: LocationStatus;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  parking: string;
  power: string;
  notes: string;
}

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

export function locationFields(props: Props): LocationFields {
  return {
    name: text(props.name),
    status: isLocationStatus(props.status) ? props.status : 'tbd',
    address: text(props.address),
    contact_name: text(props.contact_name),
    contact_phone: text(props.contact_phone),
    contact_email: text(props.contact_email),
    parking: text(props.parking),
    power: text(props.power),
    notes: text(props.notes),
  };
}

/** The live locations in the project, by name (an unnamed one last), with the live scenes and frames set there. */
export function projectLocations(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
): { record: SbdRecord; fields: LocationFields; scenes: SbdRecord[]; frames: SbdRecord[] }[] {
  const all = Object.values(records);
  const liveScene = (id: string | null) => {
    const scene = id ? records[id] : undefined;
    return scene?.type === 'scene' && scene.trashedAt === null;
  };
  return all
    .filter((r) => r.type === 'location' && r.parentId === projectId && r.trashedAt === null)
    .map((record) => ({
      record,
      fields: locationFields(record.props),
      scenes: all.filter((s) => s.type === 'scene' && s.trashedAt === null && s.props.location_id === record.id),
      // Frames shot here though their scene is set elsewhere (3.3b), so a place only they use never reads as unused.
      frames: all.filter((f) => f.type === 'shot' && f.trashedAt === null && f.props.location_id === record.id && liveScene(f.parentId) && records[f.parentId ?? '']?.props.location_id !== record.id),
    }))
    .sort((a, b) => (a.fields.name === '' ? 1 : b.fields.name === '' ? -1 : a.fields.name.localeCompare(b.fields.name)));
}

/**
 * Where a frame is shot (3.3, docs/PHASE3_DECISIONS.md 2): its own location when it has one (an insert or a pickup
 * shot elsewhere), else its scene's. Only a live location counts: one in the Trash reads as none.
 */
export function frameLocationId(records: Readonly<Record<string, SbdRecord>>, shot: SbdRecord): string | null {
  const live = (id: unknown) => {
    const record = typeof id === 'string' ? records[id] : undefined;
    return record?.type === 'location' && record.trashedAt === null ? record.id : null;
  };
  const own = live(shot.props.location_id);
  if (own) return own;
  const scene = shot.parentId ? records[shot.parentId] : undefined;
  return scene ? live(scene.props.location_id) : null;
}

/** The custom field names the project's live locations use (3.3), as frames' are worked out from frames. */
export function locationFieldRecords(records: Readonly<Record<string, SbdRecord>>): SbdRecord[] {
  return Object.values(records).filter((r) => r.type === 'location' && r.trashedAt === null);
}

/** A location's photos (3.3): its live pictures, in order. */
export function locationPhotos(records: Readonly<Record<string, SbdRecord>>, locationId: string): SbdRecord[] {
  return Object.values(records)
    // Its photos, not the PDFs and links attached to it (3.11), which are media records under it too.
    .filter((r) => r.type === 'media' && r.parentId === locationId && r.trashedAt === null && r.props.kind !== 'pdf' && r.props.kind !== 'link')
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/**
 * Where a location is on the map (3.4): the place picked from the address search (`latitude`, `longitude`, and its
 * name as the map service wrote it, `map_name`), or null before one is picked (or for values this version can't read).
 */
export function mapPlace(props: Props): Place | null {
  return placeFrom({ name: props.map_name, latitude: props.latitude, longitude: props.longitude });
}

/** The props that hold a location's place on the map. */
export const MAP_PLACE_PROPS = ['latitude', 'longitude', 'map_name'] as const;

/**
 * The props a new address takes off (3.4), for every writer (the Locations tile; suggestions, MCP and imports later):
 * a place picked for the old address would send a call sheet's map, and the crew, to the wrong place. An address only
 * re-spaced keeps its place.
 */
export function unpinnedBy(props: Props, address: string): string[] {
  const words = (value: string) => value.trim().replace(/\s+/g, ' ');
  if (words(text(props.address)) === words(address)) return [];
  return MAP_PLACE_PROPS.filter((prop) => prop in props);
}

/**
 * The location on OpenStreetMap, which needs no key and opens in any browser: its pin, once a place is picked from the
 * address search; else a search for its address (or its name with none). Null when there's nothing to show. Nothing is
 * fetched: the person opens the link.
 */
export function mapLink(fields: Pick<LocationFields, 'address' | 'name'>, place: Place | null = null): string | null {
  if (place) {
    const lat = place.latitude.toFixed(6);
    const lon = place.longitude.toFixed(6);
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  }
  const query = (fields.address.trim() || fields.name.trim()).replace(/\s+/g, ' ');
  return query === '' ? null : `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}
