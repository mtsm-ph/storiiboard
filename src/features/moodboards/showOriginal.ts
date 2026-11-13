import { useEffect, useState } from 'react';
import { originalShown } from '../../app/opener';

// Show in Finder / Show in Explorer for a board picture (5.9; Kevin, Nov 11): the words by the computer the app runs on,
// and when the action shows at all. Not an edit: nothing here writes to the project.

export type Platform = 'mac' | 'windows' | 'other';

/** The computer, from the webview's user agent (the check undoShortcuts.ts's isMac makes, and Windows told apart). */
export function platformOf(userAgent: string): Platform {
  if (/Mac/i.test(userAgent)) return 'mac';
  if (/Windows/i.test(userAgent)) return 'windows';
  return 'other';
}

/** The translation key of the action's words. */
export function showOriginalKey(platform: Platform): 'moodboard.showInFinder' | 'moodboard.showInExplorer' | 'moodboard.showInFolder' {
  return platform === 'mac' ? 'moodboard.showInFinder' : platform === 'windows' ? 'moodboard.showInExplorer' : 'moodboard.showInFolder';
}

/**
 * Whether this picture's original can be shown, asked when the picture becomes the selection and again when the window
 * regains focus (the file may have come or gone meanwhile), never on every draw. Only the latest ask sets the state, so a
 * slow answer for an earlier ask can't overwrite a newer one. `forget` is for a reveal that failed.
 */
export function useOriginalShown(recordId: string | null, sha256: string | null): [boolean, () => void] {
  const [found, setFound] = useState<{ recordId: string; exists: boolean } | null>(null);
  useEffect(() => {
    if (recordId === null || sha256 === null) return;
    let live = true;
    let latest = 0;
    const ask = () => {
      latest += 1;
      const mine = latest;
      void originalShown(recordId, sha256).then((exists) => {
        if (live && mine === latest) setFound({ recordId, exists });
      });
    };
    ask();
    window.addEventListener('focus', ask);
    return () => {
      live = false;
      window.removeEventListener('focus', ask);
    };
  }, [recordId, sha256]);
  const exists = recordId !== null && found?.recordId === recordId && found.exists;
  const forget = () => {
    setFound(recordId === null ? null : { recordId, exists: false });
  };
  return [exists, forget];
}
