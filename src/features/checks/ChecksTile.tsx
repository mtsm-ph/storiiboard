import { useId, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { useWorkspaceId } from '../../app/shell/workspaceContext';
import { useZonesAt } from '../../app/timeZone';
import { useWeatherUnits } from '../../app/weatherUnits';
import { allChecks, CHECK_KINDS, type CheckFinding, type CheckKind } from '../../core/checks';
import { t, tn } from '../../core/i18n';
import { mapPlace } from '../../core/model/location';
import { recordsOfType } from '../../core/model/recordIndex';
import { dayLabel, projectShootDays } from '../../core/model/shootDay';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { Trans } from '../../ui/Trans';
import { Words } from '../callsheets/CallSheetChecks';
import { useHeldForecasts } from '../callsheets/useHeldForecasts';
import { openShootDay } from '../schedule/shownDay';
import { CHECK_KIND_LABEL, checkSentence, sentenceText, skipWords, type CheckSentence } from './checkWords';
import { showFinding } from './showFinding';

// The Checks tile (7.4, decision 7): every check over the whole project, from the one function the MCP's `run_checks`
// returns too (allChecks in src/core/checks). Counts per check and per day at the top, then the findings by day, each
// with Show; at the foot, what could not be checked and why. The rain check reads only the forecasts already held
// (this session's and the project's cache), never the network. Any workspace can open it; it sits in Production's
// default layout. The result is kept while nothing the checks read changes, so an edit elsewhere costs nothing here.

const NO_DAY = 'none';

/** The words as a screen reader should have them: a time on another day says "+1 day" or "−1 day", not a bare "+1". */
const spoken = (text: string): string => text.replace(/ ([+−])1/g, (_, sign: string) => ` ${sign === '+' ? t('callSheet.nextDay') : t('callSheet.previousDay')}`);

function Sentence({ sentence }: { sentence: CheckSentence }) {
  if ('text' in sentence) return <Words text={sentence.text} />;
  const parts = Object.fromEntries(
    Object.entries(sentence.values).map(([name, value]) => [name, sentence.mono.includes(name) ? <span className="font-mono">{value}</span> : value]),
  );
  return <Trans k={sentence.key} parts={parts} />;
}

export function ChecksTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const units = useWeatherUnits();
  const workspaceId = useWorkspaceId();
  const [dayChoice, setDayChoice] = useState('');
  const [kindChoice, setKindChoice] = useState<CheckKind | ''>('');
  const byCheckId = useId();
  const byDayId = useId();
  const skippedId = useId();
  // Each location's zone and the forecasts already held, as the call sheet reads them: never fetched from here.
  // From the type index, not a pass over every record on every edit.
  const points = recordsOfType(records, 'location').flatMap((record) => {
    if (!project || record.parentId !== project.projectId || record.trashedAt !== null) return [];
    const place = mapPlace(record.props);
    return place ? [{ id: record.id, latitude: place.latitude, longitude: place.longitude }] : [];
  });
  const zones = useZonesAt(points);
  const held = useHeldForecasts(points);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('checks.noProject')}</p>;
  const projectId = project.projectId;

  const { findings, skipped } = allChecks(records, projectId, { forecasts: held, zones });
  const days = projectShootDays(records, projectId);
  const dayName = (dayId: string | null) => {
    const day = dayId === null ? undefined : days.find((d) => d.record.id === dayId);
    return day ? dayLabel(day) : t('checks.noDay');
  };
  const dayKey = (dayId: string | null) => dayId ?? NO_DAY;
  // Days in the order the findings come (by date, undated after, no day last), each once.
  const dayKeys = [...new Set(findings.map((f) => dayKey(f.dayId)))];
  // A day that has no findings left (fixed, or gone) lets go of the filter, as the Trash's scene filter does.
  const dayFilter = dayKeys.includes(dayChoice) ? dayChoice : '';
  if (dayChoice !== '' && dayFilter === '') setDayChoice('');
  const kindFilter = kindChoice;
  const countOf = (pick: (f: CheckFinding) => boolean) => findings.filter(pick).length;
  const shown = findings.filter((f) => (dayFilter === '' || dayKey(f.dayId) === dayFilter) && (kindFilter === '' || f.kind === kindFilter));
  const groups: { key: string; dayId: string | null; findings: CheckFinding[] }[] = [];
  for (const finding of shown) {
    const last = groups.at(-1);
    if (last?.key === dayKey(finding.dayId)) last.findings.push(finding);
    else groups.push({ key: dayKey(finding.dayId), dayId: finding.dayId, findings: [finding] });
  }
  const skippedShown = skipped.filter((s) => (dayFilter === '' || s.dayId === dayFilter) && (kindFilter === '' || s.kinds.includes(kindFilter)));

  return (
    <div className="flex min-h-full flex-col" data-checks-tile="">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <Select
          label={t('checks.filterDay')}
          data-checks-day=""
          value={dayFilter}
          onChange={(event) => {
            setDayChoice(event.currentTarget.value);
          }}
        >
          <option value="">{t('checks.allDays')}</option>
          {dayKeys.map((key) => (
            <option key={key} value={key}>
              {dayName(key === NO_DAY ? null : key)}
            </option>
          ))}
        </Select>
        <Select
          label={t('checks.filterCheck')}
          data-checks-kind=""
          value={kindFilter}
          onChange={(event) => {
            setKindChoice(event.currentTarget.value as CheckKind | '');
          }}
        >
          <option value="">{t('checks.allChecks')}</option>
          {CHECK_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(CHECK_KIND_LABEL[kind])}
            </option>
          ))}
        </Select>
        <p className="sb-label ml-auto font-mono" data-checks-count="">
          {tn('checks.count', findings.length)}
        </p>
      </div>
      {findings.length > 0 && (
        <div className="flex flex-wrap gap-6 border-b border-border p-3 text-[12px]">
          <section aria-labelledby={byCheckId}>
            <h3 id={byCheckId} className="sb-label">
              {t('checks.byCheck')}
            </h3>
            <ul className="mt-1 flex flex-col gap-0.5" data-checks-by-kind="">
              {CHECK_KINDS.map((kind) => (
                <li key={kind} data-kind={kind} className="flex justify-between gap-3">
                  <span>{t(CHECK_KIND_LABEL[kind])}</span>
                  <span className="font-mono">{countOf((f) => f.kind === kind)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby={byDayId}>
            <h3 id={byDayId} className="sb-label">
              {t('checks.byDay')}
            </h3>
            <ul className="mt-1 flex flex-col gap-0.5" data-checks-by-day="">
              {dayKeys.map((key) => (
                <li key={key} data-day={key} className="flex justify-between gap-3">
                  <span>{dayName(key === NO_DAY ? null : key)}</span>
                  <span className="font-mono">{countOf((f) => dayKey(f.dayId) === key)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {findings.length === 0 ? (
        <p data-checks-none="" className="p-3 text-[13px]">
          {t('checks.none')}
        </p>
      ) : shown.length === 0 ? (
        <p className="p-3 text-[13px] text-text-muted">{t('checks.nothingMatches')}</p>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          {groups.map((group) => {
            const name = dayName(group.dayId);
            const headingId = `${byDayId}-${group.key}`;
            return (
              <section key={group.key} aria-labelledby={headingId} data-checks-group={group.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 border-b border-border pb-1">
                  <h3 id={headingId} className="min-w-0 flex-1 text-[13px] font-bold">
                    {name} <span className="font-mono font-normal">({group.findings.length})</span>
                  </h3>
                  {group.dayId !== null && (
                    <Button
                      data-open-day={group.dayId}
                      aria-label={t('checks.openDayNamed', { day: name })}
                      onClick={() => {
                        if (group.dayId !== null) openShootDay(workspaceId, group.dayId);
                      }}
                    >
                      {t('checks.openDay')}
                    </Button>
                  )}
                </div>
                <ul className="flex flex-col gap-1" aria-label={t('checks.findingsOf', { day: name })}>
                  {group.findings.map((finding) => {
                    const sentence = checkSentence(finding, records, projectId, units);
                    return (
                      <li key={finding.id} data-check={finding.kind} data-finding={finding.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        {/* Truffle on paper with ▲ as the second cue; in dark mode the page's text, as the strip does. */}
                        <span className="min-w-0 flex-1 text-warning dark:text-text">
                          <span aria-hidden="true">▲ </span>
                          <span className="sr-only">{t(CHECK_KIND_LABEL[finding.kind])}: </span>
                          <Sentence sentence={sentence} />
                        </span>
                        <Button
                          data-show-finding={finding.id}
                          aria-label={t('callSheet.checks.showFor', { problem: spoken(sentenceText(sentence)) })}
                          onClick={() => {
                            showFinding(finding, workspaceId, projectId);
                          }}
                        >
                          {t('callSheet.checks.show')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {skippedShown.length > 0 && (
        <section aria-labelledby={skippedId} data-checks-skipped="" className="mt-auto border-t border-border p-3 text-[12px]">
          <h3 id={skippedId} className="sb-label">
            {t('checks.skipped')}
          </h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {skippedShown.map((skip) => (
              <li key={skip.id} data-skip={skip.reason}>
                {skipWords(skip, records, projectId)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
