import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { command } from '../../core/storage/tauriDriver';
import { clearNotice, showNotice } from '../notice';
import { openProjectFile } from '../openFiles';
import { files } from '../projects/actions';

// .sbd files the OS asked the app to open (src-tauri/src/opened.rs). The queue is taken once when the page loads,
// for the double-click that launched the app, and again on every event, for one while it runs.

/** Opens the last file queued; one window holds one project. A file that can't be opened is reported as a notice. */
export function useOpenedFiles(): void {
  useEffect(() => {
    // The browser build (tests, the web companion) has no OS to hand it files.
    if (!isTauri()) return;
    const take = async () => {
      const last = (await command<string[]>('opened_files_take', {})).at(-1);
      if (last === undefined) return;
      try {
        await openProjectFile(last, files);
        clearNotice();
      } catch (error) {
        showNotice(error);
      }
    };
    const unlisten = listen('opened-files', () => {
      void take();
    });
    void take();
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);
}
