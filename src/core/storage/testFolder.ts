import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Tests only: a fresh folder in the system's temp space, so no test ever touches a real project. */
export function makeTestFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'sbd-test-'));
  return {
    dir,
    path: (...names: string[]) => join(dir, ...names),
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type TestFolder = ReturnType<typeof makeTestFolder>;

/**
 * Tests only: a newer version of `to` arriving from a sync service. On Mac and Linux it's written beside and renamed
 * over, as the services do. Windows can't rename over a file SQLite has open, so there a sync can only rewrite it in
 * place; either way the open file must notice before its next write.
 */
export function arriveFromSync(from: string, to: string): void {
  if (process.platform === 'win32') {
    writeFileSync(to, readFileSync(from));
    rmSync(from);
  } else {
    renameSync(from, to);
  }
}
