import { useEffect, useId, useState } from 'react';
import { openPdf } from '../../app/opener';
import { showNotice } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { callSheetIssues, issueTime, type CallSheet } from '../../core/model/callsheet';
import { Button } from '../../ui/Button';
import { savePdfCopy } from '../assets/attachmentEdits';
import { stillFindingZone, type ExportCallSheetOptions } from './exportCallSheet';
import { fingerprintOf, hasRecipe, printedJson } from './fingerprint';
import { issueCallSheetPdf } from './issueCallSheet';

// Issue, and the versions already issued (4.7), on the Call sheet tile: the button beside Export PDF, "Changed since
// issued" when what the sheet prints has changed (the forecast aside), and each issued PDF with Open and Save a copy.
// It sends nothing anywhere: Save a copy is how an issued PDF gets to the crew until publishing (Phase 9).

/** What the newest issue says about the sheet as it is: compared by that issue's own recipe, or not comparable. */
interface Shown {
  /** The issue it was worked out for. */
  id: string;
  kind: 'current' | 'changed' | 'unknown';
}

export function IssueButton({ sheet, options }: { sheet: CallSheet; options: ExportCallSheetOptions }) {
  const records = useProject((s) => s.records);
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const latest = callSheetIssues(records, options.dayId)[0];
  const latestId = latest?.record.id ?? '';
  const fingerprint = latest?.fingerprint ?? '';
  const version = latest?.fingerprintVersion ?? null;
  // An issue this app has no recipe for (a newer app's, or none stored) can't be compared: no claim either way.
  const comparable = latest !== undefined && fingerprint !== '' && hasRecipe(version);
  // The sheet as the issue's recipe reads it: the text changes when what the sheet prints does, and not otherwise.
  const json = comparable ? printedJson(sheet, options.app, options.projectName, version) : '';
  // While a place's time zone is still on its way the sheet has no sun yet: not compared, so the last answer stays
  // rather than flashing "Changed since issued" and back.
  const waiting = stillFindingZone(sheet);
  useEffect(() => {
    if (latestId === '' || !comparable || waiting) return;
    let current = true;
    // A hash that fails leaves the status unknown, with Issue available, never a disabled button without words.
    void fingerprintOf(json).then(
      (hash) => {
        if (current) setShown({ id: latestId, kind: hash === fingerprint ? 'current' : 'changed' });
      },
      () => {
        if (current) setShown({ id: latestId, kind: 'unknown' });
      },
    );
    return () => {
      current = false;
    };
  }, [latestId, comparable, waiting, json, fingerprint]);
  const status: Shown['kind'] | null = latest === undefined ? null : !comparable ? 'unknown' : shown?.id === latestId ? shown.kind : null;
  const nothing = status === 'current';
  const next = (latest?.version ?? 0) + 1;
  // Never disabled for a fingerprint that couldn't be compared; only while the answer is on its way, or nothing changed.
  const label = latest === undefined ? t('callSheet.issue') : nothing ? t('callSheet.issueAgain') : t('callSheet.issueVersion', { version: next });
  return (
    <>
      <Button
        variant="primary"
        data-issue-button=""
        disabled={busy || nothing || (latest !== undefined && status === null)}
        aria-describedby={nothing ? reasonId : undefined}
        onClick={() => {
          setBusy(true);
          void issueCallSheetPdf(options).finally(() => {
            setBusy(false);
          });
        }}
      >
        {label}
      </Button>
      <span aria-live="polite" className="basis-full empty:hidden">
        {latest !== undefined && status !== null && (
          <>
            {status === 'changed' ? (
              <span data-issue-status="changed" className="text-[12px] text-warning dark:text-text">
                <span aria-hidden="true">▲ </span>
                {t('callSheet.issuedChanged', { version: latest.version })}
              </span>
            ) : (
              <span data-issue-status={status} className="font-mono text-[12px]">
                {t('callSheet.issuedCurrent', { version: latest.version })}
              </span>
            )}
            {nothing && (
              <span id={reasonId} data-issue-reason="" className="ml-2 text-[12px] text-text-muted">
                {t('callSheet.issueNothing', { version: latest.version })}
              </span>
            )}
          </>
        )}
      </span>
    </>
  );
}

export function IssuedVersions({ sheet, dayId }: { sheet: CallSheet; dayId: string }) {
  const records = useProject((s) => s.records);
  const issues = callSheetIssues(records, dayId);
  if (issues.length === 0) return null;
  return (
    <section aria-label={t('callSheet.issues')} data-issued-versions="" className="border border-text p-2">
      <h3 className="sb-label">{t('callSheet.issues')}</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {issues.map((issue) => {
          const at = new Date(issue.issuedAt);
          const when = Number.isNaN(at.getTime()) ? '' : issueTime(at, issue.zone === '' ? (sheet.timesIn?.zone ?? null) : issue.zone);
          return (
            <li key={issue.record.id} data-issue-row={issue.version} data-issue-file={issue.file} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 font-mono text-[12px]">{t('callSheet.issueRow', { version: issue.version, when })}</span>
              <Button
                aria-label={t('callSheet.issueOpen', { version: issue.version })}
                onClick={() => {
                  void openPdf(issue.file, issue.name || 'call-sheet.pdf').catch(showNotice);
                }}
              >
                {t('assets.open')}
              </Button>
              <Button
                aria-label={t('callSheet.issueSaveCopy', { version: issue.version })}
                onClick={() => {
                  void savePdfCopy(issue.file, issue.name || 'call-sheet.pdf');
                }}
              >
                {t('assets.saveCopy')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
