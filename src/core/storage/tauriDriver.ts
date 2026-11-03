import { invoke } from '@tauri-apps/api/core';
import type { ProjectFile, Row, SqlDriver } from './driver';

/** Calls a Rust command. The commands reject with a plain message string; this turns it into an Error. */
export async function command<T = void>(name: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function tauriFile(handle: number, path: string): ProjectFile {
  return {
    path,
    tx: async (statements) => {
      await command('sbd_tx', { handle, statements: statements.map(({ sql, params = [] }) => ({ sql, params })) });
    },
    query: (sql, params = []) => command<Row[]>('sbd_query', { handle, sql, params }),
    backup: (kind, fileName) => command('sbd_backup', { handle, kind, fileName }),
    listBackups: () => command<string[]>('sbd_backups', { handle }),
    deleteBackup: (fileName) => command('sbd_delete_backup', { handle, fileName }),
    close: () => command('sbd_close', { handle }),
  };
}

/** The desktop app's driver: every call goes to src-tauri/src/sbd.rs, which holds the open connection. */
export const tauriDriver: SqlDriver = {
  create: async (path) => tauriFile(await command<number>('sbd_create', { path }), path),
  open: async (path) => tauriFile(await command<number>('sbd_open', { path }), path),
  copy: (source, dest) => command('sbd_copy', { source, dest }),
};
