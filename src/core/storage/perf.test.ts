import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addScene, board } from '../../features/storyboard/board';
import { placePictures, type FramePicture } from '../../features/storyboard/framePictures';
import type { PreparedImage } from '../media/store';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject } from './project';
import { makeTestFolder } from './testFolder';

// Saving on native SQLite with a 300-frame project with pictures (quality pass, Nov 5): the same edit, undo and open
// code the desktop runs, on node:sqlite in place of rusqlite (no window, no IPC). Run on request:
// `SB_PERF=1 npx vitest run src/core/storage/perf.test.ts` (PowerShell: `$env:SB_PERF='1'; npx vitest run …`, and set
// it back to '' before the gate). The screen side is e2e/perf.spec.ts.

const SCENES = 10;
const PER_SCENE = 30;

/** Bytes with every value in them, as a JPEG has: 300 KB for the picture, 20 KB for its thumbnail; no two alike. */
function bytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length).map((_, i) => (i * (seed % 251) + (i >> 8) + seed * 7) % 256);
  // The seed itself at the front, so seeds the pattern above repeats on still differ.
  new DataView(out.buffer).setUint32(0, seed);
  return out;
}

function picture(seed: number): FramePicture {
  const original = bytes(300_000, seed);
  const image: PreparedImage = {
    original: { sha256: createHash('sha256').update(original).digest('hex'), bytes: original, mime: 'image/jpeg', width: 1920, height: 1080, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes(20_000, seed + 1), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
  return { image, source: { name: `still_${String(seed)}.jpg` } };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const ms = (value: number) => `${value.toFixed(1)} ms`;

async function timed(run: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

describe.skipIf(!process.env.SB_PERF)('a 300-frame project with pictures, saved on native SQLite', () => {
  it('edits, undoes, redoes and opens quickly', { timeout: 600_000 }, async () => {
    const folder = makeTestFolder();
    const path = folder.path('Big Board.sbd');
    const store = createProjectStore();
    const results: Record<string, string> = {};
    try {
      await store.getState().open(await createProject(path, { driver: nodeDriver, backups: false }));
      const projectId = () => store.getState().project?.projectId ?? '';
      for (let s = 0; s < SCENES; s += 1) await store.getState().apply([addScene(store.getState().records, projectId())]);
      const scenes = board(store.getState().records, projectId()).map((scene) => scene.record.id);

      const imports: number[] = [];
      for (const [s, sceneId] of scenes.entries()) {
        const pictures = Array.from({ length: PER_SCENE }, (_, i) => picture(s * PER_SCENE + i + 1));
        imports.push(
          await timed(() =>
            store.getState().applyWith((records, slate) =>
              placePictures(records, projectId(), { kind: 'scene', sceneId, afterShotId: null }, pictures, path, slate),
            ),
          ),
        );
      }
      const shots = board(store.getState().records, projectId()).flatMap((scene) => scene.shots);
      expect(shots).toHaveLength(SCENES * PER_SCENE);
      results[`write ${String(PER_SCENE)} frames with their pictures (median)`] = ms(median(imports));

      const edits: number[] = [];
      const undos: number[] = [];
      const redos: number[] = [];
      for (const [i, size] of ['CU', 'WS', 'MS', 'ECU', 'MCU', 'CU', 'WS', 'MS', 'ECU', 'MCU'].entries()) {
        const id = shots[i * 29]?.record.id ?? '';
        edits.push(await timed(() => store.getState().apply([{ kind: 'update', id, set: { shot_size: size } }])));
        undos.push(await timed(() => store.getState().undo()));
        redos.push(await timed(() => store.getState().redo()));
        // A failed write is caught and only noted in the store: timed as quick, it would read as a fast save.
        expect(store.getState().error).toBeNull();
        expect(store.getState().records[id]?.props.shot_size).toBe(size);
      }
      results['edit saved (median, slowest)'] = `${ms(median(edits))}, ${ms(Math.max(...edits))}`;
      results['undo (median, slowest)'] = `${ms(median(undos))}, ${ms(Math.max(...undos))}`;
      results['redo (median, slowest)'] = `${ms(median(redos))}, ${ms(Math.max(...redos))}`;

      await store.getState().close();
      const opening = await timed(async () => {
        await store.getState().open(await openProject(path, { driver: nodeDriver, backups: false }));
      });
      expect(Object.values(store.getState().records).filter((r) => r.type === 'shot')).toHaveLength(SCENES * PER_SCENE);
      results['open the project'] = ms(opening);
      const { statSync } = await import('node:fs');
      results['file size'] = `${(statSync(path).size / 1e6).toFixed(1)} MB`;

      console.log(`\n${String(SCENES * PER_SCENE)}-frame project on native SQLite:`);
      for (const [name, value] of Object.entries(results)) console.log(`  ${name}: ${value}`);
      // What a person would call slow, not what this machine does.
      expect(median(edits)).toBeLessThan(100);
      expect(median(undos)).toBeLessThan(100);
      expect(opening).toBeLessThan(2000);
    } finally {
      await store.getState().close();
      folder.remove();
    }
  });
});
