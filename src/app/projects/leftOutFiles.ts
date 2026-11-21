import { formatNumber, t, tn } from '../../core/i18n';
import { readClip, videoFields } from '../../core/media/video';
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
// boards, locations, people and call sheets that now show one missing. A LUT left out the same way (Kevin, Nov 18
// night 4) is counted in a sentence of its own, and the frames that play a video graded with it join the places: the
// video keeps its `lut` id, its Inspector says the LUT isn't in the project, and it plays as shot (playbackCopies.ts).

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
  const add = (place: string) => {
    if (place !== '' && !places.includes(place)) places.push(place);
  };
  for (const record of Object.values(records)) {
    if (record.type !== 'media' || record.trashedAt !== null || typeof record.props.file !== 'string' || !left.has(record.props.file)) continue;
    add(placeOf(records, projectId, record.parentId === null ? undefined : records[record.parentId]));
  }
  for (const place of lutPlaces(records, projectId, report)) add(place);
  return places;
}

/**
 * Where a left-out LUT was used (Kevin, Nov 18 night 4): each video that names it, by the frames that play it, as a
 * frame's place is named; a video no frame plays, by where it sits.
 */
function lutPlaces(records: Records, projectId: string, report: ImportReport): string[] {
  const left = new Set(report.lutsLeftOut ?? []);
  if (left.size === 0) return [];
  const live = Object.values(records).filter((record) => record.trashedAt === null);
  const places: string[] = [];
  for (const video of live) {
    // Only a real id: a video with no LUT never matches.
    const lutId = video.type === 'media' ? (videoFields(video.props)?.lutId ?? null) : null;
    if (lutId === null || !left.has(lutId)) continue;
    const frames = live.filter((shot) => shot.type === 'shot' && readClip(shot.props)?.videoId === video.id);
    const holders = frames.length > 0 ? frames : [video.parentId === null ? undefined : records[video.parentId]];
    for (const holder of holders) places.push(placeOf(records, projectId, holder));
  }
  return places;
}

/**
 * The import's note: how many pictures and other files were left out of how many, and where they now show missing.
 * '' when nothing was left out. `every`: every place named, for the notice's Copy list (round 4), else at most
 * MAX_PLACES and a count of the rest.
 */
export function leftOutNote(records: Records, projectId: string, report: ImportReport, every = false): string {
  const luts = report.lutsLeftOutCount ?? report.lutsLeftOut?.length ?? 0;
  if (report.leftOut.length === 0 && luts === 0) return '';
  const pictures = report.leftOut.filter((file) => file.picture).length;
  const files = report.leftOut.length - pictures;
  const sentences: string[] = [];
  // The project's one picture, file or LUT left out reads as a sentence, never "1 of 1" (Kevin, Nov 19); one of
  // several keeps its count.
  if (pictures === 1 && report.pictures === 1) sentences.push(t('projectJson.pictureLeftOut'));
  else if (pictures > 0) sentences.push(tn('projectJson.picturesLeftOut', pictures, { total: formatNumber(report.pictures) }));
  if (files === 1 && report.files === 1) sentences.push(t('projectJson.fileLeftOut'));
  else if (files > 0) sentences.push(tn('projectJson.filesLeftOut', files, { total: formatNumber(report.files) }));
  // LUTs in their own sentence, of the same shape (Kevin, Nov 18 night 4); their videos' frames join the places. The
  // sentence only when the total is known to be one: a report without it keeps the count.
  if (luts === 1 && report.luts === 1) sentences.push(t('projectJson.lutLeftOut'));
  else if (luts > 0) sentences.push(tn('projectJson.lutsLeftOut', luts, { total: formatNumber(report.luts ?? luts) }));
  const places = leftOutPlaces(records, projectId, report);
  if (places.length > 0) {
    // At most MAX_PLACES named, so a project with hundreds left out still says it in one line.
    const shown = every ? places.length : MAX_PLACES;
    const named = places.slice(0, shown).join(', ');
    const more = places.length - shown;
    // One thing left out in all reads "It shows", agreeing in number (Kevin, Nov 19). Only what can show somewhere
    // counts: a LUT left out with no id is named nowhere, so its count stays out.
    const showing = report.leftOut.length + (report.lutsLeftOut ?? []).filter((id) => id !== '').length;
    const where = showing === 1 ? 'projectJson.leftOutWhereOne' : 'projectJson.leftOutWhere';
    sentences.push(t(where, { places: more > 0 ? tn('projectJson.leftOutMore', more, { places: named }) : named }));
  }
  return sentences.join(' ');
}
