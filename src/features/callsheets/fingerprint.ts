import type { CallSheet, CallSheetIssue, SheetContact, SheetCrewPerson } from '../../core/model/callsheet';
import { keptHospital, type ZoneSource } from '../../core/model/location';
import type { DirectionsApp } from '../../core/storage/settings';
import { sha256 } from '../assets/attachmentEdits';

// "Changed since issued" (4.7, decision 5): a fingerprint of everything the PDF prints except the forecast and the issue
// header itself. It is made from the sheet's data, not its words, so the app's language and the paper don't move it;
// the forecast (its values, fetch time and expiry) isn't in the sheet at all. Sun times are, so a new date or place
// counts, and so do the hospital, contacts, calls, notes, scenes and people.

/**
 * The recipe that makes new fingerprints, and the number stored beside each as `fingerprint_version`. A recipe is
 * frozen once an issue has been made with it: it lives in RECIPES forever, and a change to what the sheet hashes is a
 * new recipe under a new number, never an edit of an old one (the golden test in fingerprint.test.ts fails on any
 * edit). "Changed since issued" computes the live fingerprint with the recipe of the issue it compares with, so an
 * upgrade alone never flips it (CLAUDE.md, Kevin Nov 9: an approval current before an upgrade stays current after it).
 * An issue whose version has no recipe here (made by a newer app, or none stored) can't be compared: the tile then
 * makes no claim either way and keeps Issue available.
 */
export const FINGERPRINT_VERSION = 1;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON with every object's keys in order, so the same data is the same text whatever order it was built in. */
export function stableJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] as Json)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const contact = (c: SheetContact | null): Json => (c ? { phone: c.phone, email: c.email } : null);
const crewPerson = (p: SheetCrewPerson): Json => ({ name: p.fields.name, title: p.fields.title, role: p.fields.role, call: p.call, contact: contact(p.contact) });

interface Inputs {
  sheet: CallSheet;
  app: DirectionsApp;
  projectName: string;
}

/**
 * Recipe 1: what the sheet prints, as plain data. It hashes what is stored (the date, the place, the zone, the country
 * code, the hospital as kept, the map app's id) and not what the app works out from it (the directions link, the sun
 * times, the emergency number, the hospital's distance), so a refactor or a table edit in the code never flips an issue
 * already made. `numbersLocked` is left out: it isn't printed, and issuing sets it.
 */
/**
 * A zone as stored input: its name only when it was typed on the location. One found from the map comes from the
 * place (hashed already) through tzf's table in the code, and one that is this computer's differs from computer to
 * computer, so two computers sharing the file would disagree on "Changed since issued" (CI caught it: UTC there).
 */
const zoneInput = (zone: { zone: string; source: ZoneSource }): Json => (zone.source === 'location' ? { zone: zone.zone, source: zone.source } : { source: zone.source });

const recipe1 = ({ sheet, app, projectName }: Inputs): Json => {
  const { day } = sheet;
  return {
    title: sheet.title || projectName,
    day: { number: day.number, count: sheet.dayCount, date: day.fields.date, call: day.fields.callTime, wrap: day.fields.wrapTime },
    timesIn: sheet.timesIn ? zoneInput(sheet.timesIn) : null,
    locations: sheet.locations.map(({ record, fields, place, zone }) => {
      const kept = keptHospital(record.props);
      return {
        id: record.id,
        name: fields.name,
        status: fields.status,
        address: fields.address,
        parking: fields.parking,
        power: fields.power,
        contactName: fields.contact_name,
        contactPhone: fields.contact_phone,
        place: place ? { latitude: place.latitude, longitude: place.longitude } : null,
        // The link and its QR code are printed whenever there is a place, an address or a name; the app picks the link.
        directions: place !== null || fields.address.trim() !== '' || fields.name.trim() !== '' ? app : null,
        zone: zone ? zoneInput(zone) : null,
        country: fields.country_code,
        hospital: kept
          ? { name: kept.name, address: kept.address, phone: kept.phone, place: kept.place, emergency: kept.emergency, fromSearch: kept.fromSearch }
          : null,
      };
    }),
    scenes: sheet.scenes.map(({ record, fields, locationIds, frames, characters }) => ({
      id: record.id,
      number: fields.number,
      name: fields.name,
      intExt: fields.intExt,
      dayNight: fields.dayNight,
      pageEighths: fields.pageEighths,
      locationIds,
      frames,
      characters: characters.map((c) => ({ name: c.name, cast: c.cast ? c.cast.fields.name : null, onDay: c.onDay })),
    })),
    cast: sheet.cast.map((c) => ({
      id: c.person.record.id,
      name: c.person.fields.name,
      characters: c.characters,
      call: c.times.call,
      hmuReady: c.times.hmuReady,
      onSet: c.times.onSet,
      contact: contact(c.contact),
    })),
    crew: sheet.crew.map((g) => ({ department: g.department, call: g.call, people: g.people.map(crewPerson) })),
    notes: { general: sheet.notes.general, safety: sheet.notes.safety },
  };
};

/** Every recipe ever used, by version. Never edit one; add the next. */
const RECIPES: Readonly<Record<number, (inputs: Inputs) => Json>> = { 1: recipe1 };

/** Whether this app knows the recipe a stored fingerprint was made with. */
export const hasRecipe = (version: number | null): version is number => version !== null && Object.hasOwn(RECIPES, version);

/** The sheet's printed data as stable text under one recipe (the current one by default). */
export function printedJson(sheet: CallSheet, app: DirectionsApp, projectName: string, version: number = FINGERPRINT_VERSION): string {
  const make = RECIPES[version];
  if (!make) throw new Error(`No fingerprint recipe ${String(version)}`);
  return stableJson(make({ sheet, app, projectName }));
}

/** SHA-256 (hex) of the printed data, as the media store hashes bytes. */
export const fingerprintOf = (json: string): Promise<string> => sha256(new TextEncoder().encode(json));

export const callSheetFingerprint = (sheet: CallSheet, app: DirectionsApp, projectName: string): Promise<string> => fingerprintOf(printedJson(sheet, app, projectName));

/**
 * Whether the sheet changed since `latest` (the newest live issue) was issued, by that issue's own recipe; null when
 * it can't be said (no recipe for its version, or no fingerprint stored).
 */
export async function changedSince(latest: Pick<CallSheetIssue, 'fingerprint' | 'fingerprintVersion'>, sheet: CallSheet, app: DirectionsApp, projectName: string): Promise<boolean | null> {
  if (latest.fingerprint === '' || !hasRecipe(latest.fingerprintVersion)) return null;
  return latest.fingerprint !== (await fingerprintOf(printedJson(sheet, app, projectName, latest.fingerprintVersion)));
}
