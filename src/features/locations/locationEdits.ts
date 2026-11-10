import { imageStatements, mediaProps, type ImageSource, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { isTimeZone } from '../../core/model/sunTimes';
import type { Statement } from '../../core/storage/driver';
import { countryCodeOf, HOSPITAL_PROPS, MAP_PLACE_PROPS, mapPlace, unpinnedBy } from '../../core/model/location';
import type { Hospital } from '../../core/net/hospitals';
import type { Place } from '../../core/net/places';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the Locations tile makes (3.3): a new location, one field changed, one sent to the Trash. Each is one op
// group, so one ⌘Z. Scenes set there keep their link while it's in the Trash, so restoring it puts them back with it.

type Records = Readonly<Record<string, SbdRecord>>;

/** A new, empty location after the project's others (in the Trash too, so a restored one never shares a key). */
export function newLocation(records: Records, projectId: string, id: string = crypto.randomUUID()): Extract<Change, { kind: 'create' }> {
  const last = Object.values(records)
    .filter((r) => r.type === 'location' && r.parentId === projectId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  return { kind: 'create', record: { id, type: 'location', parentId: projectId, sortKey: keyBetween(last, null), props: { name: '', status: 'tbd' } } };
}

/**
 * One field of a location, from the location as it is at the edit's turn; nothing when it's already that, or gone. A
 * new address takes the place on the map (3.4) off in the same edit (unpinnedBy); one ⌘Z puts both back.
 */
export function locationChange(records: Records, id: string, prop: string, value: string): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const current = typeof location.props[prop] === 'string' ? location.props[prop] : '';
  if (current === value) return [];
  const pin = prop === 'address' ? unpinnedBy(location.props, value) : [];
  return [{ kind: 'update', id, set: { [prop]: value }, ...(pin.length > 0 ? { unset: pin } : {}) }];
}


/**
 * The location's time zone (4.3) set by hand, or unset (null: back to the zone from the map), in one edit. Nothing when
 * it's already that, the zone isn't one this computer knows, or the location isn't live.
 */
export function timeZoneChange(records: Records, id: string, zone: string | null): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const current = isTimeZone(location.props.time_zone) ? location.props.time_zone : null;
  if (zone === null) return 'time_zone' in location.props ? [{ kind: 'update', id, unset: ['time_zone'] }] : [];
  if (!isTimeZone(zone) || zone === current) return [];
  return [{ kind: 'update', id, set: { time_zone: zone } }];
}

/**
 * A place picked from the address search (3.4) put on the location, in one edit: where it is and its name on the map.
 * The address as typed stays (it's what the crew reads); an empty one takes the place's name. Nothing when the
 * location isn't live or is already there.
 */
export function placeLocation(records: Records, id: string, place: Place): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const now = mapPlace(location.props);
  if (now && now.name === place.name && now.latitude === place.latitude && now.longitude === place.longitude) return [];
  const address = typeof location.props.address === 'string' ? location.props.address : '';
  return [
    {
      kind: 'update',
      id,
      set: { latitude: place.latitude, longitude: place.longitude, map_name: place.name, ...(address.trim() === '' ? { address: place.name } : {}) },
      // A new pick is where the search says, not where a pin was dragged (4.9).
      ...('map_moved' in location.props ? { unset: ['map_moved'] } : {}),
    },
  ];
}

/** Degrees kept to 6 places, about 10 cm: a drag's pixels are no finer than that. */
const sixPlaces = (degrees: number) => Math.round(degrees * 1e6) / 1e6;

/**
 * The pin dragged (or moved from the keyboard) to where the crew should go (4.9), in one edit: the new `latitude` and
 * `longitude`, `map_moved` set so the sheet can say the pin was placed by hand, and `map_name` kept as it was. Nothing
 * when the location has no place yet, isn't live, the point isn't on the Earth, or it is where the pin already is.
 */
export function movePin(records: Records, id: string, latitude: number, longitude: number): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const now = mapPlace(location.props);
  if (!now || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
  const [lat, lon] = [sixPlaces(latitude), sixPlaces(longitude)];
  if (lat === now.latitude && lon === now.longitude) return [];
  return [{ kind: 'update', id, set: { latitude: lat, longitude: lon, map_moved: true } }];
}

/** The location's place on the map taken off (its address stays); nothing when it has none. */
export function unplaceLocation(records: Records, id: string): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const props = MAP_PLACE_PROPS.filter((prop) => prop in location.props);
  return props.length === 0 ? [] : [{ kind: 'update', id, unset: props }];
}

/**
 * A hospital picked from the search (4.5) kept on the location, in one edit: its name, address, phone and where it is,
 * whether OpenStreetMap says it has an emergency department, and that it came from the search. The location's country
 * is set from the hospital's only when the location has none. Nothing when the location isn't live.
 */
export function pickHospital(records: Records, id: string, hospital: Hospital): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const set: Record<string, string | number | boolean> = {
    hospital_name: hospital.name,
    hospital_address: hospital.address,
    hospital_latitude: hospital.latitude,
    hospital_longitude: hospital.longitude,
    hospital_source: 'osm',
  };
  const unset: string[] = [];
  // Missing, not false, when unknown: the prop says "yes" or says nothing.
  if (hospital.emergency) set.hospital_emergency = true;
  else unset.push('hospital_emergency');
  if (hospital.phone !== null) set.hospital_phone = hospital.phone;
  else unset.push('hospital_phone');
  if (countryCodeOf(location.props.country_code) === '' && hospital.countryCode !== null) set.country_code = hospital.countryCode;
  return [{ kind: 'update', id, set, unset: unset.filter((prop) => prop in location.props) }];
}

/** The location's hospital taken off, all of it, in one edit; nothing when it has none. */
export function clearHospital(records: Records, id: string): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const props = HOSPITAL_PROPS.filter((prop) => prop in location.props);
  return props.length === 0 ? [] : [{ kind: 'update', id, unset: props }];
}

/**
 * The hospital's name, address or phone typed by hand (4.5), one edit each. Typed over a picked hospital it may be
 * another one, so what OpenStreetMap said about the old one must not be printed for the new: a new name takes off the
 * emergency-room flag and where it is (the sheet then says to check, and gives no distance), a new address takes off
 * where it is, a phone takes off nothing. `hospital_source` stays until Clear or a new pick: crediting OpenStreetMap
 * too much is harmless, too little is not.
 */
export function hospitalFieldChange(records: Records, id: string, prop: 'hospital_name' | 'hospital_address' | 'hospital_phone', value: string): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const current = typeof location.props[prop] === 'string' ? location.props[prop] : '';
  if (current === value) return [];
  // Only a change of words takes the search's facts off: spaces added or trimmed leave the same hospital.
  const words = (text: string) => text.trim().replace(/\s+/g, ' ');
  const stale = (
    words(current) === words(value)
      ? []
      : {
          hospital_name: ['hospital_emergency', 'hospital_latitude', 'hospital_longitude'],
          hospital_address: ['hospital_latitude', 'hospital_longitude'],
          hospital_phone: [] as string[],
        }[prop]
  ).filter((p) => p in location.props);
  return [{ kind: 'update', id, set: { [prop]: value }, ...(stale.length > 0 ? { unset: stale } : {}) }];
}

/** The location's country (4.5) set by hand (ISO 3166-1 alpha-2), or unset with null. Nothing when it's already that. */
export function countryChange(records: Records, id: string, code: string | null): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  if (code === null) return 'country_code' in location.props ? [{ kind: 'update', id, unset: ['country_code'] }] : [];
  const upper = code.toUpperCase();
  if (countryCodeOf(upper) === '' || upper === location.props.country_code) return [];
  return [{ kind: 'update', id, set: { country_code: upper } }];
}

/** A location to the Trash; its scenes keep their link, so a restore brings them back with it. */
export function trashLocation(records: Records, id: string): Change[] {
  const location = records[id];
  return location?.type === 'location' && location.trashedAt === null ? [{ kind: 'trash', id }] : [];
}

/**
 * Photos added to a location (3.3), after its others, in one edit: each a picture under the location, stored as a
 * frame's picture is. Nothing when the location isn't live.
 */
export function addLocationPhotos(
  records: Records,
  locationId: string,
  photos: readonly { image: PreparedImage; source: ImageSource }[],
  projectPath: string,
  now = new Date(),
): { changes: Change[]; alsoWrite: Statement[] } {
  const location = records[locationId];
  if (location?.type !== 'location' || location.trashedAt !== null || photos.length === 0) return { changes: [], alsoWrite: [] };
  let last = Object.values(records)
    .filter((r) => r.parentId === locationId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  const changes: Change[] = [];
  const alsoWrite: Statement[] = [];
  for (const { image, source } of photos) {
    last = keyBetween(last, null);
    changes.push({ kind: 'create', record: { id: crypto.randomUUID(), type: 'media', parentId: locationId, sortKey: last, props: mediaProps(image, source, projectPath) } });
    alsoWrite.push(...imageStatements(image, now));
  }
  return { changes, alsoWrite };
}

/** A location's photo to the Trash. */
export function trashLocationPhoto(records: Records, photoId: string): Change[] {
  const photo = records[photoId];
  const parent = photo?.parentId ? records[photo.parentId] : undefined;
  return photo?.type === 'media' && photo.trashedAt === null && parent?.type === 'location' ? [{ kind: 'trash', id: photoId }] : [];
}
