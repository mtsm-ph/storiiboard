import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../app/projectStore';
import { videoDriver } from '../../app/video';
import { resolveSourcePath, videoFields } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';

// Whether each linked video's file can be read on this computer (2.2b), for the missing flag on frames and in the
// inspector (CLAUDE.md: flag missing media clearly and offer Relink). Checked when a project opens, when its videos
// change, and when the window comes back into focus (a card plugged in, a folder moved back). A file this computer
// may not read (linked on another computer, outside the project's folder) needs Relink just the same, so it counts
// as missing. The browser build keeps no paths, so its videos are never flagged.

interface VideoStatus {
  /** Video record ids whose file isn't there, or isn't readable here. */
  missing: Readonly<Record<string, true>>;
}

export const videoStatusStore = createStore<VideoStatus>()(() => ({ missing: {} }));

/** The live video records and where each one's file should be. */
function linked(records: Readonly<Record<string, SbdRecord>>, projectPath: string): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  for (const record of Object.values(records)) {
    if (record.type !== 'media' || record.trashedAt !== null) continue;
    const video = videoFields(record.props);
    if (!video || video.sourcePath === '') continue;
    out.push({ id: record.id, path: resolveSourcePath(video.sourcePath, projectPath) });
  }
  return out;
}

let run = 0;

/** Looks at every linked video's file now. */
export async function checkVideos(): Promise<void> {
  const { project, records } = projectStore.getState();
  const mine = ++run;
  const videos = project ? linked(records, project.file.path) : [];
  if (!project || videos.length === 0) {
    videoStatusStore.setState({ missing: {} });
    return;
  }
  let statuses: Awaited<ReturnType<typeof videoDriver.status>>;
  try {
    statuses = await videoDriver.status(
      videos.map((v) => v.path),
      project.file.nativeHandle,
    );
  } catch {
    return;
  }
  // A later check, or another project, has the last word.
  if (mine !== run || projectStore.getState().project !== project) return;
  const missing: Record<string, true> = {};
  videos.forEach((video, i) => {
    if (statuses[i]?.exists !== true) missing[video.id] = true;
  });
  videoStatusStore.setState({ missing });
}

/** What the check depends on: the project, and each live video's id and path. */
function signature(): string {
  const { project, records } = projectStore.getState();
  if (!project) return '';
  const videos = linked(records, project.file.path).map((v) => `${v.id}=${v.path}`);
  return [project.file.path, ...videos].join('\n');
}

let watching = false;

/** Starts checking on open, on change and on focus; once per page. */
function watch(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  let last = signature();
  void checkVideos();
  projectStore.subscribe(() => {
    const next = signature();
    if (next === last) return;
    last = next;
    void checkVideos();
  });
  window.addEventListener('focus', () => {
    void checkVideos();
  });
}

/** Whether this video's file is missing here; false while unknown. */
export function useVideoMissing(videoId: string | null): boolean {
  watch();
  return useStore(videoStatusStore, (s) => (videoId ? s.missing[videoId] === true : false));
}

/** Every missing video at once, for the board. */
export function useMissingVideos(): Readonly<Record<string, true>> {
  watch();
  return useStore(videoStatusStore, (s) => s.missing);
}
