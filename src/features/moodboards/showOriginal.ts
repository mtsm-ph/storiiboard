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
 * Whether the action shows: one picture selected (not a video card or a link) and Rust (or the development stand-in) saying
 * its recorded original is there, which it never does for a picture with none recorded or a missing file, nor in a browser
 * build. Otherwise no action at all, never a disabled one.
 */
export function showsOriginalAction(state: { selected: number; kind: string; exists: boolean }): boolean {
  return state.selected === 1 && state.kind === 'picture' && state.exists;
}

/**
 * Whether this picture's original can be shown, asked when the picture becomes the selection and again when the window
 * regains focus (the file may have come or gone meanwhile), never on every draw. `forget` is for a reveal that failed.
 */
export function useOriginalShown(sha256: string | null): [boolean, () => void] {
  const [found, setFound] = useState<{ sha256: string; exists: boolean } | null>(null);
  useEffect(() => {
    if (sha256 === null) return;
    let live = true;
    const ask = () => {
      void originalShown(sha256).then((exists) => {
        if (live) setFound({ sha256, exists });
      });
    };
    ask();
    window.addEventListener('focus', ask);
    return () => {
      live = false;
      window.removeEventListener('focus', ask);
    };
  }, [sha256]);
  const exists = sha256 !== null && found?.sha256 === sha256 && found.exists;
  const forget = () => {
    setFound(sha256 === null ? null : { sha256, exists: false });
  };
  return [exists, forget];
}
