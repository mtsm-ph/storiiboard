import { allChecks, type CheckFinding, type CheckTarget } from '../../src/core/checks/allChecks';
import { t } from '../../src/core/i18n';
import { assistantView, NO_DEPARTMENT_FLAGS, viewText } from '../../src/core/model/assistantView';
import type { JsonValue, SbdRecord } from '../../src/core/model/record';
import { sceneSetups } from '../../src/core/model/setup';
import { projectShootDays, type ShootDay } from '../../src/core/model/shootDay';
import { sceneFields, shotFields } from '../../src/core/model/storyboard';
import { CHECK_KIND_LABEL, checkSentence, oldForecastWords, sentenceText, skipWords } from '../../src/features/checks/checkWords';
import type { ToolContext } from './tools';

// run_checks (7.6, Phase 7 decisions 7 and 16): the project's checks from the one function the Checks tile runs
// (src/core/checks/allChecks.ts), each finding in the tile's own words (English: the server's language) with its target
// as ids and slate numbers, and what couldn't be checked and why. The forecasts are only those the project already holds
// (read from the file by project.ts): the server never fetches one. No zone is looked up either (the desktop app asks
// Rust for a place's zone), so a location needs its time zone typed for its light and rain to be checked, and says so.
// The checks run on the records the assistant view keeps (the Trash and a hidden department's material left out) with
// their props, as the readers need them; only what's picked below goes out, every string of it through the view's text
// rule (round 2: a phone typed in a location's, a person's or a gear item's name never comes back), then the guard.

type Obj = { [key: string]: JsonValue };

/**
 * The zones the server has looked up: none, as an empty map. A location with its zone typed reads in it; one with none
 * typed reads as still waiting for its zone (callSheet's own rule), so its light and rain are skipped with "no zone",
 * never read in this computer's zone, which isn't the project's (7.5 round 2).
 */
const NO_ZONES: ReadonlyMap<string, string | null> = new Map();

const name = (records: Readonly<Record<string, SbdRecord>>, id: string): string => {
  const value = records[id]?.props.name;
  return typeof value === 'string' ? value.trim() : '';
};

export function runChecks(context: ToolContext): Obj {
  const { data } = context;
  const view = assistantView(data.records, { departments: context.departments ?? NO_DEPARTMENT_FLAGS });
  const records = view.scoped;
  const projectId = data.projectId;
  const days = projectShootDays(records, projectId);
  const dayOut = (dayId: string | null): Obj | null => {
    const day: ShootDay | undefined = dayId === null ? undefined : days.find((d) => d.record.id === dayId);
    return day ? { id: day.record.id, number: day.number, date: day.fields.date || null } : null;
  };
  const sceneOut = (sceneId: string): Obj | null => {
    const scene = records[sceneId];
    return scene?.type === 'scene' ? { id: sceneId, number: sceneFields(scene.props).number } : null;
  };
  const targetOut = (target: CheckTarget): Obj => {
    switch (target.kind) {
      case 'shot':
        return { kind: 'frame', frame: { id: target.shotId, number: shotFields(records[target.shotId]?.props ?? {}).number }, scene: sceneOut(target.sceneId) };
      case 'plan': {
        const setup = sceneSetups(records, target.sceneId).find((s) => s.record.id === target.setupId);
        return { kind: 'plan', scene: sceneOut(target.sceneId), setup: setup ? { id: setup.record.id, number: setup.number } : null, item_ids: [...target.itemIds] };
      }
      case 'location':
        return { kind: 'location', location: { id: target.locationId, name: name(records, target.locationId) } };
      case 'sheet':
        return { kind: 'call_sheet', day: dayOut(target.dayId) };
    }
  };
  const result = allChecks(records, projectId, { forecasts: data.forecasts ?? new Map(), fetchedAt: data.forecastsFetchedAt ?? new Map(), zones: NO_ZONES, now: Date.now() });
  const findingOut = (found: CheckFinding): Obj => ({
    id: found.id,
    kind: found.kind,
    check: t(CHECK_KIND_LABEL[found.kind]),
    words: sentenceText(checkSentence(found, records, projectId, 'metric')),
    day: dayOut(found.dayId),
    target: targetOut(found.target),
  });
  return viewText({
    findings: result.findings.map(findingOut),
    skipped: result.skipped.map((skip) => ({
      id: skip.id,
      kinds: [...skip.kinds],
      reason: skip.reason,
      words: skipWords(skip, records, projectId),
      day: dayOut(skip.dayId),
      location: skip.locationId === null ? null : { id: skip.locationId, name: name(records, skip.locationId) },
    })),
    old_forecasts: result.oldForecasts.map((old) => ({
      id: old.id,
      day: dayOut(old.dayId),
      location: { id: old.locationId, name: name(records, old.locationId) },
      fetched_at: old.fetchedAt,
      // Without its time: the words would give it in this computer's zone (round 2: no computer zone goes out).
      words: oldForecastWords({ ...old, fetchedAt: null }, records),
    })),
    note:
      'The same checks as the Project checks tile, from the same function. The rain check reads only the forecasts the project already holds (these tools never fetch one), ' +
      "and a location's light and rain are checked only when its time zone is typed: no zone is looked up here. Amounts are metric.",
  }) as Obj;
}
