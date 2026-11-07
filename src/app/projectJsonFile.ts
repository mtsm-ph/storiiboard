import { invoke } from '@tauri-apps/api/core';
import { t } from '../core/i18n';
import { isTauriApp } from './fileAccess';

// Project data to import (2.9): a JSON file a project exported. In the desktop app it comes from Rust's Open dialog
// and is read through Rust, which reads only files the person picked (src-tauri/src/pictures.rs); in the browser build,
// from a file input.

export interface ProjectJsonFile {
  /** As the person saw it: `Bey County project data.json`. */
  name: string;
  bytes(): Promise<ArrayBuffer>;
}

/** The Open dialog for project data; null when it's cancelled. */
export async function chooseProjectJson(): Promise<ProjectJsonFile | null> {
  if (isTauriApp) {
    const [path] = await invoke<string[]>('project_json_choose', { title: t('dialogs.importProjectData'), kind: t('dialogs.projectDataFilter') });
    if (!path) return null;
    return { name: path.split(/[/\\]/).pop() ?? path, bytes: () => invoke<ArrayBuffer>('pictures_read', { path }) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.dataset.projectJsonInput = '';
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
