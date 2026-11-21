import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { bringInDropped, bringInFolder, changeFileAtPath, findInFolder } from './changeFiles';
import { isTauriApp } from './fileAccess';
import { onChangeFilesDrop } from './pictures';
import { useProject } from './projectStore';

// Change files in (7.1), at the shell's root: the project's suggestions folder brought in when a project opens, and
// what's new in it found (never brought in: 7.1 round 2) when the window comes back to the front, by Tauri's own window
// focus event, not the page's; and a `.sbdchanges` dropped anywhere on the window brought in (desktop app). In the
// browser build each drop target leaves change files out of pictures (the storyboard's drops, a moodboard's and a
// plan's), and only the storyboard's hands them here. Draws nothing.
export function ChangeFilesHost() {
  const project = useProject((s) => s.project);
  useEffect(() => {
    if (project) void bringInFolder();
  }, [project]);

  useEffect(() => {
    if (!isTauriApp) return;
    let live = true;
    const stops: (() => void)[] = [];
    const keep = (unlisten: () => void) => {
      if (live) stops.push(unlisten);
      else unlisten();
    };
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void findInFolder();
      })
      .then(keep);
    void onChangeFilesDrop((paths) => {
      void bringInDropped(paths.map(changeFileAtPath));
    }).then(keep);
    return () => {
      live = false;
      for (const stop of stops) stop();
    };
  }, []);
  return null;
}
