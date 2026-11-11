import { list, t, type MessageKey } from '../../core/i18n';
import type { CallSheetFinding } from '../../core/checks';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { locationFields } from '../../core/model/location';
import { personFields } from '../../core/model/person';
import type { SbdRecord } from '../../core/model/record';
import { DAY_NIGHT_LABEL, sceneFields, sceneLabel } from '../../core/model/storyboard';
import type { SunRange } from '../../core/model/sunTimes';
import { precipitationText, type WeatherUnits } from '../../core/net/weather';

// The call sheet checks in words (4.8), in the app's language. Findings carry ids and codes, never text, so a change
// of language rewords them.

type Records = Readonly<Record<string, SbdRecord>>;

const DETAIL: Record<'address' | 'contact' | 'parking', MessageKey> = {
  address: 'callSheet.check.detail.address',
  contact: 'callSheet.check.detail.contact',
  parking: 'callSheet.check.detail.parking',
};

const REASON: Record<'dialogue' | 'cast' | 'frames', MessageKey> = {
  dialogue: 'callSheet.check.departmentMissing.dialogue',
  cast: 'callSheet.check.departmentMissing.cast',
  frames: 'callSheet.check.departmentMissing.frames',
};

/** A sun range as "06:20–07:10"; a time on another date has " +1" or " −1" (the strip draws those as the sheet does). */
const rangeText = (range: SunRange): string => {
  const mark = (time: string, next: boolean, prev: boolean) => `${time}${next ? ' +1' : prev ? ' −1' : ''}`;
  return `${mark(range.start, range.startNext, range.startPrev)}–${mark(range.end, range.endNext, range.endPrev)}`;
};

const locationName = (records: Records, id: string) => locationFields(records[id]?.props ?? {}).name || t('trash.unnamedLocation');
const personName = (records: Records, id: string) => personFields(records[id]?.props ?? {}).name || t('people.unnamed');
const sceneName = (records: Records, id: string) => sceneLabel(sceneFields(records[id]?.props ?? {}).number);

export function findingWords(finding: CallSheetFinding, records: Records, units: WeatherUnits): string {
  switch (finding.kind) {
    case 'location-missing':
      return t('callSheet.check.locationMissing', { location: locationName(records, finding.locationId), details: list(finding.missing.map((d) => t(DETAIL[d]))) });
    case 'department-missing':
      return t(REASON[finding.reason], { department: DEPARTMENT_LABELS[finding.department] });
    case 'hmu-too-short': {
      const name = personName(records, finding.personId);
      if (finding.problem === 'after-on-set') return t('callSheet.check.hmuAfterOnSet', { name, ready: finding.hmuReady, onSet: finding.onSet });
      if (finding.gap < 0) return t('callSheet.check.hmuBefore', { name, ready: finding.hmuReady, call: finding.call });
      return t('callSheet.check.hmuShort', { name, ready: finding.hmuReady, call: finding.call, gap: finding.gap, minimum: finding.minimum });
    }
    case 'golden-hour-midday': {
      const params = { scene: sceneName(records, finding.sceneId), when: DAY_NIGHT_LABEL[finding.dayNight], location: locationName(records, finding.locationId), times: list(finding.golden.map(rangeText)) };
      return t(finding.golden.length > 0 ? 'callSheet.check.golden' : 'callSheet.check.goldenNone', params);
    }
    case 'exterior-rain':
      return finding.cause === 'precipitation' && finding.mm !== null
        ? t('callSheet.check.rainAmount', { scene: sceneName(records, finding.sceneId), amount: precipitationText(finding.mm, units) })
        : t('callSheet.check.rainConditions', { scene: sceneName(records, finding.sceneId), conditions: finding.conditions ? t(finding.conditions).toLocaleLowerCase() : '' });
  }
}

/** Where on the call sheet a finding is fixed or seen: a selector inside the tile, or null. */
export function findingTarget(finding: CallSheetFinding, canAddPeople: boolean): string | null {
  switch (finding.kind) {
    case 'location-missing':
      return `[data-sheet-location="${CSS.escape(finding.locationId)}"]`;
    case 'department-missing':
      // Who is on the day is chosen in the "Who's on the day" section; with everyone already on, there is nowhere to go.
      return canAddPeople ? '[data-add-person], [data-choose-people]' : null;
    case 'hmu-too-short':
      return `[data-sheet-cast="${CSS.escape(finding.personId)}"] [data-time="hmu_ready"]`;
    case 'golden-hour-midday':
    case 'exterior-rain':
      return `[data-sheet-scene="${CSS.escape(finding.sceneId)}"]`;
  }
}
