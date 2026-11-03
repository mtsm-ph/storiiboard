import { mkdtempSync, rmSync } from 'node:fs';
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
