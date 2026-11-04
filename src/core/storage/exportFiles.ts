import { invoke } from '@tauri-apps/api/core';

// Where exports go (1.24, CLAUDE.md: files go to disk through src/core/storage). In the desktop app Rust shows the
// Save or folder dialog and writes only where the person chose (src-tauri/src/export.rs); a set of files goes into a
// new folder made inside the one they picked, so nothing already there is overwritten. In the browser build (the
// end-to-end tests) each file downloads.

export interface ExportTarget {
  /** Where it went, as the person would say it: the file or the folder. */
  readonly label: string;
  /** Writes one file; for a single-file export, `name` is the file chosen. */
  write(name: string, bytes: Uint8Array): Promise<void>;
}

/** Packs a header and bytes for export_write: a 4-byte big-endian length, the JSON header, then the bytes. */
function writeBody(header: { path: string; name?: string }, bytes: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const body = new Uint8Array(4 + json.length + bytes.length);
  new DataView(body.buffer).setUint32(0, json.length);
  body.set(json, 4);
  body.set(bytes, 4 + json.length);
  return body;
}

const lastPart = (path: string) => path.split(/[/\\]/).pop() ?? path;

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // After the download has its own copy.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

const downloading = (name: string, bytes: Uint8Array): Promise<void> => {
  download(name, bytes);
  return Promise.resolve();
};

/** The Save dialog for one file, suggesting `name`; null when cancelled. */
export async function chooseExportFile(name: string, desktop: boolean): Promise<ExportTarget | null> {
  if (!desktop) return { label: name, write: downloading };
  const path = await invoke<string | null>('export_choose_file', { name });
  if (path === null) return null;
  return {
    label: lastPart(path),
    write: async (_file, bytes) => {
      await invoke('export_write', writeBody({ path }, bytes));
    },
  };
}

/** The folder dialog for a set of files: they go into a new folder `folder` inside the one picked. Null when cancelled. */
export async function chooseExportFolder(folder: string, desktop: boolean): Promise<ExportTarget | null> {
  if (!desktop) return { label: folder, write: downloading };
  const path = await invoke<string | null>('export_choose_folder', { folder });
  if (path === null) return null;
  return {
    label: lastPart(path),
    write: async (name, bytes) => {
      await invoke('export_write', writeBody({ path, name }, bytes));
    },
  };
}
