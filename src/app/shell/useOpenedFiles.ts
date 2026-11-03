import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { tauriAppData } from '../../core/storage/appData';
import { command, tauriDriver } from '../../core/storage/tauriDriver';
import { openProjectFile } from '../openFiles';
import { projectStore } from '../projectStore';

// .sbd files the OS asked the app to open (src-tauri/src/opened.rs). The queue is taken once when the page loads,
// for the double-click that launched the app, and again on every event, for one while it runs.

/** Opens the last file queued; one window holds one project. Reports why a file couldn't open, or null once one has. */
export function useOpenedFiles(onError: (message: string | null) => void): void {
  useEffect(() => {
    // The browser build (tests, the web companion) has no OS to hand it files.
    if (!isTauri()) return;
    const take = async () => {
      const last = (await command<string[]>('opened_files_take', {})).at(-1);
      if (last === undefined) return;
      try {
        await openProjectFile(last, { store: projectStore, driver: tauriDriver, recent: tauriAppData });
        onError(null);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
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
  }, [onError]);
}
