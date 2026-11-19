import { formatNumber, t, tn } from '../../core/i18n';
import { locationFields } from '../../core/model/location';
import { personFields } from '../../core/model/person';
import type { SbdRecord } from '../../core/model/record';
import { dayLabel, projectShootDays } from '../../core/model/shootDay';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { ImportReport } from '../../core/storage/projectJson';
import { boardTitle } from '../../features/moodboards/boards';

// What Import project data says when it left stored files out (6.27b round 3, Kevin Nov 18): bytes that didn't match
// their hash were never stored (projectJson.ts, leaveOutDamagedFiles), the records that use them stay and show them
// missing, and the person is told how many and where: "3 of 240 pictures were damaged and left out." with the frames,
// boards, locations, people and call sheets that now show one missing.

type Records = Readonly<Record<string, SbdRecord>>;

/** Where a record that holds a stored file sits, as a person finds it: "SC 04 · Frame 4A", "Board · Mood"; '' if nowhere. */
function placeOf(records: Records, projectId: string, holder: SbdRecord | undefined, seen = 0): string {
  if (!holder || seen > 16) return '';
  const parent = holder.parentId === null ? undefined : records[holder.parentId];
  switch (holder.type) {
    case 'project':
      return t('assets.onProject');
    case 'scene':
      return sceneLabel(sceneFields(holder.props).number);
    case 'shot': {
      const frame = t('assets.onFrame', { frame: shotFields(holder.props).number || '—' });
      return parent?.type === 'scene' ? t('assets.frameInScene', { scene: sceneLabel(sceneFields(parent.props).number), frame }) : frame;
    }
    case 'location':
      return t('assets.onLocation', { name: locationFields(holder.props).name || t('locations.unnamed') });
    case 'person':
      return t('assets.onPerson', { name: personFields(holder.props).name || t('people.unnamed') });
    case 'board':
      return t('projectJson.onBoard', { name: boardTitle(holder) });
    case 'callsheet': {
      const day = projectShootDays(records, projectId).find((d) => d.record.id === holder.parentId);
      return day ? t('projectJson.onCallSheet', { day: dayLabel(day) }) : '';
    }
    case 'shoot_day': {
      const day = projectShootDays(records, projectId).find((d) => d.record.id === holder.id);
      return day ? dayLabel(day) : '';
    }
    default:
      // A board's item, a video's still: named by what holds it.
      return placeOf(records, projectId, parent, seen + 1);
  }
}

/** The most places the note names; the rest are counted ("and 2 more"). */
const MAX_PLACES = 10;

/** The places the left-out files were used, each once, in the order the records come. */
export function leftOutPlaces(records: Records, projectId: string, report: ImportReport): string[] {
  const left = new Set(report.leftOut.map((file) => file.sha256));
  const places: string[] = [];
  for (const record of Object.values(records)) {
    if (record.type !== 'media' || record.trashedAt !== null || typeof record.props.file !== 'string' || !left.has(record.props.file)) continue;
    const parent = record.parentId === null ? undefined : records[record.parentId];
    const place = placeOf(records, projectId, parent);
    if (place !== '' && !places.includes(place)) places.push(place);
  }
  return places;
}

/**
 * The import's note: how many pictures and other files were left out of how many, and where they now show missing.
 * '' when nothing was left out. `every`: every place named, for the notice's Copy list (round 4), else at most
 * MAX_PLACES and a count of the rest.
 */
export function leftOutNote(records: Records, projectId: string, report: ImportReport, every = false): string {
  if (report.leftOut.length === 0) return '';
  const pictures = report.leftOut.filter((file) => file.picture).length;
  const files = report.leftOut.length - pictures;
  const sentences: string[] = [];
  if (pictures > 0) sentences.push(tn('projectJson.picturesLeftOut', pictures, { total: formatNumber(report.pictures) }));
  if (files > 0) sentences.push(tn('projectJson.filesLeftOut', files, { total: formatNumber(report.files) }));
  const places = leftOutPlaces(records, projectId, report);
  if (places.length > 0) {
    // At most MAX_PLACES named, so a project with hundreds left out still says it in one line.
    const shown = every ? places.length : MAX_PLACES;
    const named = places.slice(0, shown).join(', ');
    const more = places.length - shown;
    sentences.push(t('projectJson.leftOutWhere', { places: more > 0 ? tn('projectJson.leftOutMore', more, { places: named }) : named }));
  }
  return sentences.join(' ');
}
