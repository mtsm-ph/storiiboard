import { CHANGED_ON_DISK } from '../../core/storage/driver';
import { formatDate, localizeError, t, type MessageKey } from '../../core/i18n';

// The status bar's "Saved" sign (6.5.4, Kevin Nov 16): when the last change reached the file and when the newest backup
// was made. Saving is as ever, every op group committed at once and a backup every 5 minutes when the project changed;
// the sign only reads what the store already knows (projectStore's savedAt, saveFailed, changedOnDisk and backupAt), so
// it adds no timer, no polling and no write. Worked out here, apart from the component, so a unit test reads every case.

export interface SavedSignState {
  /** When the last op group was committed (ISO), or null when the project has none yet. */
  savedAt: string | null;
  /** When the newest backup was made (ISO), or null when it has none. */
  backupAt: string | null;
  /** Why the last edit's commit failed, or null: the store's `saveFailed`. */
  saveFailed: string | null;
  /** The file was replaced on disk (a sync) and the app is about to reopen it: the last change wasn't written. */
  changedOnDisk: boolean;
}

/** One message and what fills it, so the component can draw its times in mono (Trans) and tests can read it as text. */
export interface Phrase {
  key: MessageKey;
  /** `time` and `day` are technical values, drawn in JetBrains Mono; anything else (a reason) is plain text. */
  params: Readonly<Record<string, string>>;
}

export interface SavedSignText {
  /** Its two halves as the status bar shows them: "Saved 14:32" or "Not saved"; "Backup 14:30" or "No backup yet". */
  saved: Phrase;
  backup: Phrase;
  /** The same in whole sentences: "Saved at 14:32." and "Last backup at 14:30.", or "on {day} at" another day. */
  savedSentence: Phrase;
  backupSentence: Phrase;
  /** What the status bar shows: "Saved 14:32 · Backup 14:30". */
  text: string;
  /** The sentences together: "Saved at 14:32. Last backup at 14:30." */
  label: string;
  /** Its accessible description: the sentences, then how saving and backups work. */
  description: string;
  /** True when the last change didn't reach the file: the sign shows "Not saved" in the warning colour. */
  failed: boolean;
}

export const say = (phrase: Phrase): string => t(phrase.key, phrase.params);

const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

/** "14:32" (or "02:32 PM", as the language and region write times, as the Trash does). */
const clockTime = (at: Date) => formatDate(at, { hour: '2-digit', minute: '2-digit' });
/** "Nov 15": a short date for a time from another day. */
const shortDay = (at: Date) => formatDate(at, { month: 'short', day: 'numeric' });

/** "14:32" today; "Nov 15 14:32" another day. */
export function signTime(at: Date, now: Date): string {
  if (startOfDay(at) === startOfDay(now)) return clockTime(at);
  return t('time.dayAndTime', { day: shortDay(at), time: clockTime(at) });
}

/**
 * A stored time cut to its minute (6.26), ISO: all the sign shows of it is its day, hour and minute, so the component
 * reads the store through this and draws again once a minute of edits, not once an edit (a held key is 30 edits a
 * second). A minute starts at the same instant in every zone a computer keeps today. One that can't be read stays as
 * it is.
 */
export function signMinute(iso: string | null): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(Math.floor(at / 60_000) * 60_000).toISOString();
}

const when = (iso: string | null): Date | null => {
  if (iso === null) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** A sentence for a time: `atKey` today, `onKey` (with the day) another day. */
const sentence = (at: Date, now: Date, atKey: MessageKey, onKey: MessageKey): Phrase =>
  startOfDay(at) === startOfDay(now)
    ? { key: atKey, params: { time: clockTime(at) } }
    : { key: onKey, params: { day: shortDay(at), time: clockTime(at) } };

export function savedSignText({ savedAt, backupAt, saveFailed, changedOnDisk }: SavedSignState, now = new Date()): SavedSignText {
  // Known (6.24): a stored time can be ahead of this computer's clock (a file from a computer whose clock was ahead, or
  // steps whose times ran ahead of a clock that went back, a millisecond each). It is shown as it is, never corrected.
  const saved = when(savedAt);
  const backup = when(backupAt);
  // A change that never reached the file never reads "Saved": the words are the ones its notice shows, translated. A
  // file a sync replaced says what that error says while the app reopens the newer version.
  const reason = saveFailed ?? (changedOnDisk ? CHANGED_ON_DISK : null);
  const failed = reason !== null;
  const savedPhrase: Phrase = failed
    ? { key: 'savedSign.notSaved', params: {} }
    : saved
      ? { key: 'savedSign.saved', params: { time: signTime(saved, now) } }
      : { key: 'savedSign.savedNoTime', params: {} };
  const backupPhrase: Phrase = backup ? { key: 'savedSign.backup', params: { time: signTime(backup, now) } } : { key: 'savedSign.noBackup', params: {} };
  const savedSentence: Phrase = failed
    ? { key: 'savedSign.notSavedLabel', params: { reason: localizeError(reason) } }
    : saved
      ? sentence(saved, now, 'savedSign.savedAt', 'savedSign.savedOn')
      : { key: 'savedSign.savedNoTimeLabel', params: {} };
  const backupSentence: Phrase = backup ? sentence(backup, now, 'savedSign.backupAt', 'savedSign.backupOn') : { key: 'savedSign.noBackupLabel', params: {} };
  const label = t('savedSign.label', { saved: say(savedSentence), backup: say(backupSentence) });
  return {
    saved: savedPhrase,
    backup: backupPhrase,
    savedSentence,
    backupSentence,
    text: t('savedSign.text', { saved: say(savedPhrase), backup: say(backupPhrase) }),
    label,
    description: t('savedSign.description', { label, how: t('savedSign.how') }),
    failed,
  };
}
