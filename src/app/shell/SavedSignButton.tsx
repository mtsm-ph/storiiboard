import { useEffect, useId, useState, type FocusEvent } from 'react';
import { useProject } from '../projectStore';
import { openSettings } from '../settings/settingsStore';
import { t } from '../../core/i18n';
import { cx } from '../../ui/cx';
import { Trans } from '../../ui/Trans';
import { savedSignText, say, signMinute, type Phrase } from './savedSign';

// The status bar's "Saved 14:32 · Backup 14:30" (6.5.4). A button: it opens Settings → Backups. Its name is what it
// shows, so a person using voice control can say it (WCAG 2.5.3, axe's label-content-name-mismatch), and its
// description reads whole ("Saved at 14:32. Last backup at 14:30.") with how saving works; a tooltip on hover and on
// keyboard focus says the same, as the tool strip's does, and Escape hides it. Times in JetBrains Mono, as every
// technical value. It only reads the store: no timer, no write.

/** A sentence with its time and day in mono. */
function Words({ phrase }: { phrase: Phrase }) {
  const parts = Object.fromEntries(
    Object.entries(phrase.params).map(([name, value]) => [name, name === 'time' || name === 'day' ? <span className="font-mono">{value}</span> : value]),
  );
  return <Trans k={phrase.key} parts={parts} />;
}

/**
 * The time the sign reads "today" against. It changes only when the window comes back (focus, or the page shown
 * again), events rather than a timer, so a sign left open overnight gets its date the next time anyone looks.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);
  return now;
}

export function SavedSign() {
  // To the minute, which is all the sign shows (savedSign.ts, signMinute): the store's time changes with every edit.
  const savedAt = useProject((s) => signMinute(s.savedAt));
  const backupAt = useProject((s) => s.backupAt);
  const saveFailed = useProject((s) => s.saveFailed);
  const changedOnDisk = useProject((s) => s.changedOnDisk);
  const now = useNow();
  const [tip, setTip] = useState(false);
  const howId = useId();
  const sign = savedSignText({ savedAt, backupAt, saveFailed, changedOnDisk }, now);
  useEffect(() => {
    if (!tip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [tip]);
  return (
    <div className="relative">
      <button
        type="button"
        data-saved-sign={sign.failed ? 'failed' : 'saved'}
        aria-describedby={howId}
        onClick={() => {
          setTip(false);
          openSettings('backups');
        }}
        onPointerEnter={() => {
          setTip(true);
        }}
        onPointerLeave={() => {
          setTip(false);
        }}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          // Keyboard focus only: a click's focus already has the pointer over it.
          if (event.currentTarget.matches(':focus-visible')) setTip(true);
        }}
        onBlur={() => {
          setTip(false);
        }}
        className="sb-label font-mono whitespace-nowrap hover:underline focus-visible:outline-offset-2"
      >
        <Trans
          k="savedSign.text"
          parts={{
            // A failed save is a filled warning label (Truffle, paper text), so it reads by its words and its fill.
            saved: <span className={cx(sign.failed && 'bg-warning px-1 text-paper-fixed')}>{say(sign.saved)}</span>,
            backup: say(sign.backup),
          }}
        />
      </button>
      <span id={howId} hidden>
        {sign.description}
      </span>
      {tip && (
        // The button's name and description already say all this to a screen reader, so the box is for the eye only.
        <span
          aria-hidden="true"
          data-saved-tip=""
          className="pointer-events-none absolute right-0 bottom-full z-30 mb-2 block w-72 border-[1.5px] border-text bg-surface px-2 py-1 text-[12px] text-text"
        >
          <span className="block font-semibold">
            <Trans k="savedSign.label" parts={{ saved: <Words phrase={sign.savedSentence} />, backup: <Words phrase={sign.backupSentence} /> }} />
          </span>
          <span className="block">{t('savedSign.how')}</span>
        </span>
      )}
    </div>
  );
}
