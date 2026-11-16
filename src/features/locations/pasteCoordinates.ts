import { projectStore } from '../../app/projectStore';
import { parseCoordinates, type Coordinates, type CoordinatesRefusal } from '../../core/model/coordinates';
import { pasteCoordinatesChanges } from './locationEdits';

// Coordinates pasted on a location (6.5.5): read by the one parser, then written in one edit (pasteCoordinatesChanges),
// worked out from the records as it lands. Nothing is requested, ever: no address search, no lookup of any kind (the
// zone is found from the place afterwards, offline, as a moved pin's is).

export type PasteOutcome = { ok: true; place: Coordinates; written: boolean } | { ok: false; reason: CoordinatesRefusal };

export async function putPastedCoordinates(locationId: string, text: string): Promise<PasteOutcome> {
  const read = parseCoordinates(text);
  if (!read.ok) return read;
  const place = { latitude: read.latitude, longitude: read.longitude };
  const written = await projectStore.getState().applyWith((now) => ({ changes: pasteCoordinatesChanges(now, locationId, place.latitude, place.longitude) }));
  return { ok: true, place, written };
}
