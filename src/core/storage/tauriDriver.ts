import { invoke } from '@tauri-apps/api/core';
import type { BackupFile, LockHolder, ProjectFile, Row, SqlDriver, Statement } from './driver';

/**
 * Calls a Rust command. The commands reject with a plain message string; this turns it into an Error. Bytes as the
 * arguments go over raw, as the request body (sbd_tx_raw).
 */
export async function command<T = void>(name: string, args: Record<string, unknown> | Uint8Array): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * A transaction with bytes among its parameters, packed for `sbd_tx_raw` (src-tauri/src/sbd.rs): a 4-byte length,
 * the JSON header, then the bytes, each parameter pointing at its own with `{ $blob: [offset, length] }`.
 */
export function packRawTx(handle: number, statements: readonly Statement[]): Uint8Array {
  const blobs: Uint8Array[] = [];
  let offset = 0;
  const header = {
    handle,
    statements: statements.map(({ sql, params = [] }) => ({
      sql,
      params: params.map((param) => {
        if (!(param instanceof Uint8Array)) return param;
        blobs.push(param);
        const at = { $blob: [offset, param.length] };
        offset += param.length;
        return at;
      }),
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const body = new Uint8Array(4 + json.length + offset);
  new DataView(body.buffer).setUint32(0, json.length);
  body.set(json, 4);
  let at = 4 + json.length;
  for (const blob of blobs) {
    body.set(blob, at);
    at += blob.length;
  }
  return body;
}

function tauriFile(handle: number, path: string): ProjectFile {
  return {
    path,
    tx: async (statements) => {
      // Bytes can't ride in JSON, so a transaction carrying an image goes raw; everything else stays plain.
      if (statements.some(({ params = [] }) => params.some((p) => p instanceof Uint8Array))) {
        await command('sbd_tx_raw', packRawTx(handle, statements));
        return;
      }
      await command('sbd_tx', { handle, statements: statements.map(({ sql, params = [] }) => ({ sql, params })) });
    },
    query: (sql, params = []) => command<Row[]>('sbd_query', { handle, sql, params }),
    readBlob: async (sql, params = []) => {
      const bytes = new Uint8Array(await command<ArrayBuffer>('sbd_read_blob', { handle, sql, params }));
      return bytes.length === 0 ? null : bytes;
    },
    backup: (kind, fileName) => command('sbd_backup', { handle, kind, fileName }),
    listBackups: () => command<BackupFile[]>('sbd_backups', { handle }),
    deleteBackup: (fileName) => command('sbd_delete_backup', { handle, fileName }),
    placeBackups: (nextToProject) => command<string>('sbd_place_backups', { handle, nextToProject }),
    backupsFolder: () => command<string>('sbd_backups_folder', { handle }),
    showBackups: () => command('sbd_show_backups', { handle }),
    refreshLock: () => command('sbd_lock_refresh', { handle }),
    close: () => command('sbd_close', { handle }),
  };
}

/** The desktop app's driver: every call goes to src-tauri/src/sbd.rs, which holds the open connection. */
export const tauriDriver: SqlDriver = {
  create: async (path) => tauriFile(await command<number>('sbd_create', { path }), path),
  open: async (path) => tauriFile(await command<number>('sbd_open', { path }), path),
  copy: (source, dest) => command('sbd_copy', { source, dest }),
  lockHolder: (path) => command<LockHolder | null>('sbd_lock_holder', { path }),
};
