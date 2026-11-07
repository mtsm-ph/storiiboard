import { invoke } from '@tauri-apps/api/core';
import { t } from '../core/i18n';
import { isTauriApp } from './fileAccess';

// A LUT file to load for a video (2.5). In the desktop app it comes from Rust's Open dialog and is read through Rust,
// which reads only files the person picked (src-tauri/src/pictures.rs); in the browser build, from a file input.

export interface LutFile {
  /** As the person saw it: `SLog3SGamut3.CineToLC-709.cube`. */
  name: string;
  text(): Promise<string>;
}

/** The Open dialog for a `.cube`; null when it's cancelled. */
export async function chooseLut(): Promise<LutFile | null> {
  if (isTauriApp) {
    const [path] = await invoke<string[]>('lut_choose', { title: t('dialogs.loadLut'), kind: t('dialogs.lutFilter') });
    if (!path) return null;
    return {
      name: path.split(/[/\\]/).pop() ?? path,
      text: async () => new TextDecoder().decode(await invoke<ArrayBuffer>('pictures_read', { path })),
    };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cube';
    input.hidden = true;
    const done = (file: File | null) => {
      input.remove();
      resolve(file ? { name: file.name, text: () => file.text() } : null);
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
