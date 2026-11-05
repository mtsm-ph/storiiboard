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

/** Whether two maps of missing videos name the same ones. */
function same(a: Readonly<Record<string, true>>, b: Readonly<Record<string, true>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === true);
}

/** Sets the map, keeping the old object when nothing changed, so the board doesn't redraw on every focus. */
function setMissing(missing: Record<string, true>): void {
  if (!same(videoStatusStore.getState().missing, missing)) videoStatusStore.setState({ missing });
}

/**
 * How long one batch of files may take before it's given up on, keeping what was known for them: a network share that
 * stopped answering can take tens of seconds a file.
 */
export const CHECK_TIMEOUT_MS = 8000;
/** Files asked about in one call, so a large project on a slow share is checked a batch at a time, each in time. */
export const CHECK_BATCH = 100;

type Statuses = Awaited<ReturnType<typeof videoDriver.status>>;

/** One batch's statuses, or null when it errs or takes too long. */
async function statusesOf(paths: readonly string[], handle: number | undefined): Promise<Statuses | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      videoDriver.status(paths, handle),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function checkOnce(): Promise<void> {
  const { project, records } = projectStore.getState();
  const videos = project ? linked(records, project.file.path) : [];
  if (!project || videos.length === 0) {
    setMissing({});
    return;
  }
  const before = videoStatusStore.getState().missing;
  const missing: Record<string, true> = {};
  for (let at = 0; at < videos.length; at += CHECK_BATCH) {
    const batch = videos.slice(at, at + CHECK_BATCH);
    const statuses = await statusesOf(
      batch.map((v) => v.path),
      project.file.nativeHandle,
    );
    // Another project opened meanwhile: its own check has the last word.
    if (projectStore.getState().project !== project) return;
    batch.forEach((video, i) => {
      // A batch that couldn't be answered keeps what was known about its videos.
      const flagged = statuses ? statuses[i]?.exists !== true : before[video.id] === true;
      if (flagged) missing[video.id] = true;
    });
  }
  setMissing(missing);
}

let running: { project: unknown; done: Promise<void> } | null = null;
let again = false;
const askedAgain = () => again;

/**
 * Looks at every linked video's file now. One check at a time for a project: asked again while one runs (a focus
 * during a slow drive's answer), it runs once more after, rather than piling up checks. A batch given up on after its
 * time limit still runs to its end in Rust, so a share that stays unreachable can have a few of those going at once.
 * Another project doesn't wait behind the last one's check: its flags clear at once and its own check starts.
 */
export function checkVideos(): Promise<void> {
  const { project } = projectStore.getState();
  if (running && running.project === project) {
    again = true;
    return running.done;
  }
  if (running) setMissing({});
  const mine: { project: unknown; done: Promise<void> } = { project, done: Promise.resolve() };
  mine.done = (async () => {
    do {
      again = false;
      await checkOnce();
      // Read through a function: set by another call while this one awaited, which the type checker can't see.
    } while (askedAgain() && running === mine);
  })().finally(() => {
    if (running === mine) running = null;
  });
  running = mine;
  return mine.done;
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
  let seen = { records: projectStore.getState().records, project: projectStore.getState().project };
  void checkVideos();
  projectStore.subscribe((state) => {
    // Most store changes aren't to records at all (an error, a busy flag): the same records and project, nothing to do.
    if (state.records === seen.records && state.project === seen.project) return;
    seen = { records: state.records, project: state.project };
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
