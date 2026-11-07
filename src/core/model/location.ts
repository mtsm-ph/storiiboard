import type { JsonValue, Props, SbdRecord } from './record';
import { labels } from '../i18n';

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

/** The live locations in the project, by name (an unnamed one last), with the live scenes set there. */
export function projectLocations(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
): { record: SbdRecord; fields: LocationFields; scenes: SbdRecord[] }[] {
  const all = Object.values(records);
  return all
    .filter((r) => r.type === 'location' && r.parentId === projectId && r.trashedAt === null)
    .map((record) => ({
      record,
      fields: locationFields(record.props),
      scenes: all.filter((s) => s.type === 'scene' && s.trashedAt === null && s.props.location_id === record.id),
    }))
    .sort((a, b) => (a.fields.name === '' ? 1 : b.fields.name === '' ? -1 : a.fields.name.localeCompare(b.fields.name)));
}

/**
 * A map search for the location, by its address (or its name with none): OpenStreetMap's, which needs no key and
 * opens in any browser. Null when there's nothing to search for. Nothing is fetched: the person opens the link.
 */
export function mapLink(fields: Pick<LocationFields, 'address' | 'name'>): string | null {
  const query = (fields.address.trim() || fields.name.trim()).replace(/\s+/g, ' ');
  return query === '' ? null : `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}
