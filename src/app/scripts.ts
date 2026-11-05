import { invoke } from '@tauri-apps/api/core';
import { t } from '../core/i18n';
import { isTauriApp } from './fileAccess';

// A script file to import (1.17). In the desktop app it comes from Rust's Open dialog and is read through Rust, which
// reads only files the person picked (src-tauri/src/pictures.rs); in the browser build, from a file input.

export interface ScriptFile {
  /** As the person saw it: `Bey County.fountain`. */
  name: string;
  bytes(): Promise<ArrayBuffer>;
}

/** What the Open dialog offers; src-tauri/src/pictures.rs lists the same for the desktop app. */
export const SCRIPT_EXTENSIONS = ['fountain', 'spmd', 'txt', 'fdx', 'pdf'] as const;

/** The Open dialog for a script; null when it's cancelled. */
export async function chooseScript(): Promise<ScriptFile | null> {
  if (isTauriApp) {
    const [path] = await invoke<string[]>('script_choose', { title: t('dialogs.importScript'), kind: t('dialogs.scriptsFilter') });
    if (!path) return null;
    return { name: path.split(/[/\\]/).pop() ?? path, bytes: () => invoke<ArrayBuffer>('pictures_read', { path }) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SCRIPT_EXTENSIONS.map((e) => `.${e}`).join(',');
    input.hidden = true;
    const done = (file: File | null) => {
      input.remove();
      resolve(file ? { name: file.name, bytes: () => file.arrayBuffer() } : null);
    };
    input.addEventListener('change', () => {
      done(input.files?.[0] ?? null);
    });
    input.addEventListener('cancel', () => {
      done(null);
    });
    document.body.append(input);
    input.click();
  });
}
