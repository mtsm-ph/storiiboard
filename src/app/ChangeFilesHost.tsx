import { useEffect } from 'react';
import { bringInDropped, bringInFolder, changeFileAtPath } from './changeFiles';
import { isTauriApp } from './fileAccess';
import { onChangeFilesDrop } from './pictures';
import { useProject } from './projectStore';

// Change files in (7.1), at the shell's root: the project's suggestions folder brought in when a project opens and when
// the window comes back to the front, and a `.sbdchanges` dropped anywhere on the window brought in (desktop app; the
// browser build's drops reach the board's own handler, which hands change files here too). Draws nothing.
export function ChangeFilesHost() {
  const project = useProject((s) => s.project);
  useEffect(() => {
    if (project) void bringInFolder();
  }, [project]);

  useEffect(() => {
    if (!isTauriApp) return;
    const onFocus = () => {
      void bringInFolder();
    };
    window.addEventListener('focus', onFocus);
    let live = true;
    let stop: (() => void) | null = null;
    void onChangeFilesDrop((paths) => {
      void bringInDropped(paths.map(changeFileAtPath));
    }).then((unlisten) => {
      if (live) stop = unlisten;
      else unlisten();
    });
    return () => {
      live = false;
      stop?.();
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return null;
}
