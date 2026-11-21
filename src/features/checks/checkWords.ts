import { list, t, type MessageKey } from '../../core/i18n';
import type { CheckFinding, CheckKind, CheckSkip, OldForecast } from '../../core/checks';
import { gearFields } from '../../core/model/gear';
import { computerTimeZone, locationFields } from '../../core/model/location';
import { cameraTitle } from '../../core/model/planCamera';
import type { SbdRecord } from '../../core/model/record';
import { dayDateLabel, dayLabel, projectShootDays } from '../../core/model/shootDay';
import { shotFields } from '../../core/model/storyboard';
import { momentIn, type WeatherUnits } from '../../core/net/weather';
import { iconLabel } from '../birdseye/plan/iconWords';
import { findingWords } from '../callsheets/checkWords';
import { planPlace } from '../schedule/DaysTile';

// The Checks tile's words (7.4), in the app's language, made when shown: the findings carry ids and codes, never text.
// A call sheet finding reads exactly as on its day's strip (findingWords); the gear and lens checks, which the strip
// doesn't show, say their day and place here. A sentence is a message key and its values, with the ones that are
// technical values (a frame's number, a focal length, a scene's) named, so the tile sets them in mono.

type Records = Readonly<Record<string, SbdRecord>>;

export const CHECK_KIND_LABEL: Record<CheckKind, MessageKey> = {
  'unavailable-on-day': 'checks.kind.unavailable-on-day',
  'gear-not-on-day': 'checks.kind.gear-not-on-day',
  'golden-hour-midday': 'checks.kind.golden-hour-midday',
  'exterior-rain': 'checks.kind.exterior-rain',
  'location-missing': 'checks.kind.location-missing',
  'department-missing': 'checks.kind.department-missing',
  'hmu-too-short': 'checks.kind.hmu-too-short',
  'plan-lens-differs': 'checks.kind.plan-lens-differs',
};

/** A sentence: plain text (a call sheet finding's, whose times the tile sets in mono), or a key with its values. */
export type CheckSentence = { text: string } | { key: MessageKey; values: Record<string, string>; mono: readonly string[] };

/** The day's label as the Shoot days tile has it ("Day 2 · Tue, Nov 17"), or '' for a day that isn't live. */
export function dayNameOf(records: Records, projectId: string, dayId: string): string {
  const day = projectShootDays(records, projectId).find((d) => d.record.id === dayId);
  return day ? dayLabel(day) : '';
}

const gearName = (records: Records, id: string) => {
  const item = records[id];
  return (item && gearFields(item.props).name) || t('gear.unnamed');
};

const locationName = (records: Records, id: string) => locationFields(records[id]?.props ?? {}).name || t('trash.unnamedLocation');

const frameNumber = (records: Records, id: string) => shotFields(records[id]?.props ?? {}).number || '?';

export function checkSentence(found: CheckFinding, records: Records, projectId: string, units: WeatherUnits): CheckSentence {
  const { finding } = found;
  switch (finding.kind) {
    case 'gear-not-on-day': {
      const day = dayNameOf(records, projectId, finding.dayId);
      const items = list(finding.gearIds.map((id) => gearName(records, id)));
      // One item or several: Spanish agrees with them ("que no está", "que no están").
      const count = finding.gearIds.length;
      const place = finding.setupId === undefined ? null : planPlace(records, finding.setupId);
      if (finding.shotId === null && place) return { key: count === 1 ? 'checks.gearPlan' : 'checks.gearPlanMany', values: { scene: place.scene, setup: place.setup, items, day }, mono: ['scene'] };
      return { key: count === 1 ? 'checks.gearFrame' : 'checks.gearFrameMany', values: { frame: finding.shotId === null ? '?' : frameNumber(records, finding.shotId), items, day }, mono: ['frame'] };
    }
    case 'plan-lens-differs': {
      const place = planPlace(records, finding.setupId);
      return {
        key: 'checks.lens',
        values: {
          frame: frameNumber(records, finding.shotId),
          frameMm: t('lens.prime', { mm: finding.frameMm }),
          camera: cameraTitle(records, finding.cameraId, iconLabel),
          setup: place ? place.setup : t('history.aSetup'),
          cameraMm: t('lens.prime', { mm: finding.cameraMm }),
        },
        mono: ['frame', 'frameMm', 'cameraMm'],
      };
    }
    default:
      return { text: findingWords(finding, records, units) };
  }
}

/** A sentence as plain text: for a label, or a screen reader. */
export const sentenceText = (sentence: CheckSentence): string => ('text' in sentence ? sentence.text : t(sentence.key, sentence.values));

/** What could not be checked, in words: "No forecast held for Harbor Pier on Tue, Nov 17: rain wasn't checked". */
export function skipWords(skip: CheckSkip, records: Records, projectId: string): string {
  const dayRecord = records[skip.dayId];
  const date = typeof dayRecord?.props.date === 'string' ? dayRecord.props.date : '';
  // The date where there is one, as the brief's example says it; a day with none by its number.
  const day = dayDateLabel(date) || dayNameOf(records, projectId, skip.dayId);
  const location = skip.locationId === null ? '' : locationName(records, skip.locationId);
  switch (skip.reason) {
    case 'no-date':
      return t('checks.skip.noDate', { day });
    case 'no-zone':
      return t(skip.kinds.includes('golden-hour-midday') ? 'checks.skip.noZoneLight' : 'checks.skip.noZoneRain', { location, day });
    case 'no-forecast':
      return t('checks.skip.noForecast', { location, day });
    case 'forecast-not-covering':
      return t('checks.skip.notCovering', { location, day });
    case 'forecast-not-hours':
      return t('checks.skip.notHours', { location, day });
    case 'no-place':
      return t(skip.kinds.includes('golden-hour-midday') ? (skip.kinds.includes('exterior-rain') ? 'checks.skip.noPlace' : 'checks.skip.noPlaceLight') : 'checks.skip.noPlaceRain', { location });
  }
}

/**
 * A forecast read past its expiry, in words: "Forecast for Harbor Pier fetched Wed, Nov 18 09:14: rain checked from it".
 * The time is this computer's, where it was fetched, with its date unless it was today.
 */
export function oldForecastWords(old: OldForecast, records: Records, now: Date = new Date()): string {
  const location = locationName(records, old.locationId);
  const time = old.fetchedAt === null ? '' : momentIn(old.fetchedAt, computerTimeZone(), now);
  return time === '' ? t('checks.oldForecastUndated', { location }) : t('checks.oldForecast', { location, time });
}
