import { Fragment, useId, useRef } from 'react';
import { useWeatherUnits } from '../../app/weatherUnits';
import type { CallSheetFinding } from '../../core/checks';
import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { Button } from '../../ui/Button';
import { findingTarget, findingWords } from './checkWords';

// The call sheet's Checks strip (4.8), under the top row: what is likely wrong before the sheet goes out, each finding in
// words with the warning style (Truffle, and ▲ as the second cue), and a Show that moves focus to where it is seen or
// fixed on the sheet. The PDF never prints it.

const TIME = /(\d{2}:\d{2})(?: ([+−])1)?/g;

/** A finding's words with each time in mono, as every technical value is; a time on another day carries +1 or −1 as the sheet's do. */
function Words({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TIME)) {
    parts.push(text.slice(last, match.index));
    parts.push(
      <span key={match.index} className="font-mono">
        {match[1]}
        {match[2] && (
          <>
            <span aria-hidden="true"> {match[2]}1</span>
            <span className="sr-only"> {match[2] === '+' ? t('callSheet.nextDay') : t('callSheet.previousDay')}</span>
          </>
        )}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/** The words as a screen reader should have them: a time on another day says "+1 day" or "−1 day", not a bare "+1". */
const spoken = (text: string): string => text.replace(/ ([+−])1/g, (_, sign: string) => ` ${sign === '+' ? t('callSheet.nextDay') : t('callSheet.previousDay')}`);

export function CallSheetChecks({
  findings,
  records,
  canAddPeople,
}: {
  findings: readonly CallSheetFinding[];
  records: Readonly<Record<string, SbdRecord>>;
  /** Whether "Who's on the day" has something to add to: where a missing department is fixed. */
  canAddPeople: boolean;
}) {
  const units = useWeatherUnits();
  const headingId = useId();
  const box = useRef<HTMLElement>(null);
  const show = (target: string) => {
    // Inside the tile this strip is in: the selector is the sheet's own, and a tile never reaches into another.
    const element = box.current?.closest('[data-call-sheet]')?.querySelector<HTMLElement>(target);
    element?.focus();
    element?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <section ref={box} aria-labelledby={headingId} data-checks="" className="border border-text p-2">
      <h3 id={headingId} className="sb-label">
        {t('callSheet.checks')}
      </h3>
      {findings.length === 0 ? (
        <p data-checks-none="" className="mt-1 text-[13px]">
          {t('callSheet.checks.none')}
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {findings.map((finding, i) => {
            const words = findingWords(finding, records, units);
            const target = findingTarget(finding, canAddPeople);
            return (
              <li key={`${finding.kind}:${String(i)}`} data-check={finding.kind} className="flex flex-wrap items-center gap-2 text-[13px]">
                {/* Truffle on paper; in dark mode the page's text, as the other warnings do (it falls below AA there). */}
                <span className="min-w-0 flex-1 text-warning dark:text-text">
                  <span aria-hidden="true">▲ </span>
                  <Words text={words} />
                </span>
                {target !== null && (
                  <Button
                    aria-label={t('callSheet.checks.showFor', { problem: spoken(words) })}
                    onClick={() => {
                      show(target);
                    }}
                  >
                    {t('callSheet.checks.show')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
