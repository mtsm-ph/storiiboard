import type { CheckContext } from './context';

// Check 1 (4.8, CLAUDE.md "MCP server: Checks"): a location on a day's sheet is missing what the crew needs to get
// there. Worked out from the sheet, which holds only live locations on the day's live frames.

export type LocationDetail = 'address' | 'contact' | 'parking';

export interface LocationMissing {
  kind: 'location-missing';
  dayId: string;
  locationId: string;
  /** In the order address, contact, parking. */
  missing: LocationDetail[];
}

const blank = (value: string) => value.trim() === '';

/** One finding per location on the day, listing what it lacks. A contact is a name or a phone; either will do. */
export function locationMissing({ sheet }: CheckContext): LocationMissing[] {
  return sheet.locations.flatMap(({ record, fields }) => {
    const missing: LocationDetail[] = [];
    if (blank(fields.address)) missing.push('address');
    if (blank(fields.contact_name) && blank(fields.contact_phone)) missing.push('contact');
    if (blank(fields.parking)) missing.push('parking');
    return missing.length > 0 ? [{ kind: 'location-missing' as const, dayId: sheet.day.record.id, locationId: record.id, missing }] : [];
  });
}
