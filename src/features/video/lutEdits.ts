import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { chooseLut } from '../../app/luts';
import { showNotice } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { t, type MessageKey } from '../../core/i18n';
import { listLuts, lutStatements, lutWithSha, prepareLut, type LutProblem, type LutRow } from '../../core/media/lut';
import { videoFields } from '../../core/media/video';
import type { Change } from '../../core/ops/ops';
import { remakeCopy } from './playbackCopies';

// A video's LUT (2.5): loaded from a `.cube`, or picked from the ones the project has, or taken off. Each is one edit
// of the video's record, so it undoes, and every frame of the take shows it: a LUT belongs to the footage, not to a
// frame. The LUT's text is stored once, in the same transaction as the edit that first uses it.

/** The edit that sets a video's LUT, or takes it off (null). */
export function setLutChange(videoId: string, lutId: string | null): Change {
  return lutId === null ? { kind: 'update', id: videoId, unset: ['lut'] } : { kind: 'update', id: videoId, set: { lut: lutId } };
}

/** What each problem with a `.cube` says. */
const PROBLEM: Record<LutProblem, MessageKey> = {
  notCube: 'lut.notCube',
  oneD: 'lut.oneD',
  size: 'lut.size',
  rows: 'lut.rows',
  domain: 'lut.domain',
};

/** Bumped when a LUT is stored, so the lists of the project's LUTs read again. */
const stored = createStore<{ version: number }>()(() => ({ version: 0 }));

/**
 * Sets the video's LUT, unless it's that already or the video is gone (one undo step, or none for nothing). Its copy
 * under the new LUT is asked for at once, as after a relink: that's the copy the Player plays now.
 */
export async function setLut(videoId: string, lutId: string | null, alsoWrite: ReturnType<typeof lutStatements> = []): Promise<void> {
  // Set inside the edit, read after it lands.
  const outcome = { changed: false };
  await projectStore.getState().applyWith((records) => {
    const record = records[videoId];
    const video = record?.type === 'media' && record.trashedAt === null ? videoFields(record.props) : null;
    outcome.changed = video !== null && video.lutId !== lutId;
    if (!outcome.changed) return { changes: [] };
    return { changes: [setLutChange(videoId, lutId)], ...(alsoWrite.length > 0 ? { alsoWrite } : {}) };
  });
  if (!outcome.changed) return;
  if (alsoWrite.length > 0) stored.setState((s) => ({ version: s.version + 1 }));
  remakeCopy(videoId);
}

/** Asks for a `.cube`, checks it, stores it once and sets it as the video's LUT. */
export async function loadLut(videoId: string): Promise<void> {
  const { project } = projectStore.getState();
  if (!project) return;
  try {
    const file = await chooseLut();
    if (!file) return;
    const prepared = await prepareLut(file.name, await file.text());
    if (!prepared.ok) {
      showNotice(new Error(t(PROBLEM[prepared.problem], { name: file.name })));
      return;
    }
    // Loaded before (for this take or another): the one stored.
    const existing = await lutWithSha(project.file, prepared.lut.sha256);
    const id = existing ?? crypto.randomUUID();
    await setLut(videoId, id, existing ? [] : lutStatements(id, prepared.lut, new Date()));
  } catch (error) {
    showNotice(error);
  }
}

/** The project's LUTs, by name, for the inspector's list; read again as LUTs are stored and projects change. */
export function useProjectLuts(): readonly LutRow[] {
  const project = useProject((s) => s.project);
  const version = useStore(stored, (s) => s.version);
  const [rows, setRows] = useState<{ for: unknown; rows: readonly LutRow[] }>({ for: null, rows: [] });
  useEffect(() => {
    if (!project) return;
    let live = true;
    listLuts(project.file)
      .then((read) => {
        if (live) setRows({ for: project, rows: read });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, version]);
  return rows.for === project ? rows.rows : [];
}
