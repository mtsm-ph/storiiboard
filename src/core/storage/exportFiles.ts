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
  /**
   * A set of files that appear only once every one is made (5.6a): `stage` keeps a file under a temporary name (in the
   * browser build, in memory), `commit` gives every staged file its own name, and `abandon` takes away whatever this run
   * made, the folder included, after a Stop or a failure. A target without them writes with `write` as it always did.
   */
  stage?(name: string, bytes: Uint8Array): Promise<void>;
  commit?(): Promise<void>;
  abandon?(): Promise<void>;
}

/** Packs a header and bytes for export_write: a 4-byte big-endian length, the JSON header, then the bytes. */
function writeBody(header: { path: string; name?: string; folder?: string; action?: string; token?: string }, bytes: Uint8Array): Uint8Array {
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

/**
 * The folder dialog for a set of files: they go into a new folder `folder` inside the one picked, made when the first file is
 * written, not before (5.6a). Null when cancelled.
 */
export async function chooseExportFolder(folder: string, desktop: boolean): Promise<ExportTarget | null> {
  if (!desktop) {
    let held: { name: string; bytes: Uint8Array }[] = [];
    return {
      label: folder,
      write: downloading,
      stage: (name, bytes) => {
        held.push({ name, bytes });
        return Promise.resolve();
      },
      commit: () => {
        const files = held;
        held = [];
        for (const file of files) download(file.name, file.bytes);
        return Promise.resolve();
      },
      abandon: () => {
        held = [];
        return Promise.resolve();
      },
    };
  }
  const picked = await invoke<{ path: string; token: string } | null>('export_choose_folder', { folder });
  if (picked === null) return null;
  // The token belongs to this run alone, so a second export into the same folder makes a folder of its own.
  const { path: parent, token } = picked;
  // The folder's own name, as Rust made it ("Pitch 2" where "Pitch" was taken), once there is a folder.
  let label = folder;
  const send = async (action: string, name?: string, bytes: Uint8Array = new Uint8Array()) => {
    const made = await invoke<string>('export_write', writeBody({ path: parent, folder, action, token, ...(name === undefined ? {} : { name }) }, bytes));
    if (made !== '') label = made;
  };
  let staged: string[] = [];
  let committed: string[] = [];
  return {
    get label() {
      return label;
    },
    write: async (name, bytes) => {
      await send('stage', name, bytes);
      await send('commit', name);
    },
    stage: async (name, bytes) => {
      // Listed first: a write that fails partway still leaves a temporary file to take away.
      staged.push(name);
      await send('stage', name, bytes);
    },
    commit: async () => {
      for (const name of staged) {
        await send('commit', name);
        committed.push(name);
      }
      staged = [];
      await send('finish').catch(() => undefined);
    },
    abandon: async () => {
      const pending = staged;
      const done = committed;
      staged = [];
      committed = [];
      for (const name of pending) await send('remove_temp', name).catch(() => undefined);
      for (const name of done) await send('remove_file', name).catch(() => undefined);
      await send('remove_folder').catch(() => undefined);
    },
  };
}
