import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';
import { playbackDriver, type CopySource } from '../../app/playback';
import { projectStore } from '../../app/projectStore';
import { resolveSourcePath, videoFields } from '../../core/media/video';

// The queue of playback copies (2.3b), on the page: one copy asked of Rust at a time, the rest waiting here, in the
// order asked. Rust makes one at a time anyway, and each request it holds waits on a thread of its own; here a waiting
// copy costs nothing, comes off the queue at once when cancelled, and keeps its place. A copy is asked for when a video
// is linked or relinked, from the inspector, and (2.4) by the Player; opening a project asks for none, so a big project
// never fills the cache behind the person's back. Each video's state is kept by its record, for the open project only.

export type CopyState =
  /** Not looked for yet. */
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'queued' }
  /** How far along, 0 to 1; null until it says (a video whose length isn't known says only at the end). */
  | { kind: 'making'; done: number | null }
  /** `silent`: made without the sound, as the original's couldn't be read. */
  | { kind: 'made'; silent: boolean }
  /** Rust's message, in English: the view shows it in the app's language. */
  | { kind: 'failed'; message: string };

interface Copies {
  byVideo: Readonly<Record<string, CopyState>>;
  /** Videos waiting their turn, in order; the one being made is `making`. */
  waiting: readonly string[];
  making: string | null;
}

export const copiesStore = createStore<Copies>()(() => ({ byVideo: {}, waiting: [], making: null }));

const UNKNOWN: CopyState = { kind: 'unknown' };

function stateOf(videoId: string): CopyState {
  return copiesStore.getState().byVideo[videoId] ?? UNKNOWN;
}

function setState(videoId: string, state: CopyState): void {
  copiesStore.setState((s) => ({ byVideo: { ...s.byVideo, [videoId]: state } }));
}

/** The open project, and what Rust needs to find a video's file: where the project says it is. */
function sourceOf(videoId: string): { source: CopySource; handle: number | undefined; project: unknown } | null {
  const { project, records } = projectStore.getState();
  const record = records[videoId];
  if (!project || record?.type !== 'media' || record.trashedAt !== null) return null;
  const video = videoFields(record.props);
  if (!video) return null;
  return {
    source: { videoId, path: video.sourcePath === '' ? '' : resolveSourcePath(video.sourcePath, project.file.path) },
    handle: project.file.nativeHandle,
    project,
  };
}

/** The message of a failure, as Rust (or the stand-in) put it. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Requests whose Cancel came while they ran: whatever they end with, they ended cancelled. */
const cancelled = new Set<string>();
/** The video being made now, so a project switch can stop it. */
let current: { videoId: string; source: CopySource } | null = null;

/** Makes the next copy waiting, if none is being made. */
function next(): void {
  const { making, waiting } = copiesStore.getState();
  const [videoId, ...rest] = waiting;
  if (making !== null || videoId === undefined) return;
  copiesStore.setState({ waiting: rest, making: videoId });
  const found = sourceOf(videoId);
  if (!found) {
    // Gone since it was asked for (the Trash, another project).
    setState(videoId, { kind: 'none' });
    copiesStore.setState({ making: null });
    next();
    return;
  }
  const { source, handle, project } = found;
  current = { videoId, source };
  setState(videoId, { kind: 'making', done: null });
  playbackDriver
    .make(source, handle, (done) => {
      if (copiesStore.getState().making === videoId && !cancelled.has(videoId)) setState(videoId, { kind: 'making', done });
    })
    .then(
      (made) => {
        // Cancelled: Cancel said so already, and anything asked since (queued again, looked for) is newer.
        if (cancelled.has(videoId) || projectStore.getState().project !== project) return;
        setState(videoId, { kind: 'made', silent: made.silent });
        // Room for it may have come from older copies (the floor, the cap): those shown now are looked for again.
        for (const other of shown.keys()) if (other !== videoId) stillMade(other);
      },
      (error: unknown) => {
        if (cancelled.has(videoId) || projectStore.getState().project !== project) return;
        setState(videoId, { kind: 'failed', message: message(error) });
      },
    )
    .finally(() => {
      cancelled.delete(videoId);
      if (current?.videoId === videoId) current = null;
      copiesStore.setState({ making: null });
      next();
    });
}

/** Puts the video's copy on the queue, unless it's there already or made whole. */
export function makeCopy(videoId: string): void {
  watch();
  const state = stateOf(videoId);
  if (state.kind === 'queued' || state.kind === 'making') return;
  if (state.kind === 'made' && !state.silent) {
    remakeIfGone(videoId);
    return;
  }
  if (!sourceOf(videoId)) return;
  setState(videoId, { kind: 'queued' });
  copiesStore.setState((s) => ({ waiting: [...s.waiting, videoId] }));
  next();
}

/** Videos the page shows now (the inspector's), by how many places show each. */
const shown = new Map<string, number>();

/** Counts the video as shown (useCopy's), until the function it gives back is called. */
export function showCopy(videoId: string): () => void {
  shown.set(videoId, (shown.get(videoId) ?? 0) + 1);
  return () => {
    const left = (shown.get(videoId) ?? 1) - 1;
    if (left > 0) shown.set(videoId, left);
    else shown.delete(videoId);
  };
}

/** A copy shown as made, looked for quietly: only if it's gone since does its line change. */
function stillMade(videoId: string): void {
  if (stateOf(videoId).kind !== 'made') return;
  const found = sourceOf(videoId);
  if (!found) return;
  const { source, handle, project } = found;
  playbackDriver
    .find(source, handle)
    .then((made) => {
      if (!made && projectStore.getState().project === project && stateOf(videoId).kind === 'made') setState(videoId, { kind: 'none' });
    })
    .catch(() => undefined);
}

/**
 * A copy made when last looked, which the cap, a Clear or the floor may have removed since: looked for, and made again
 * if it's gone.
 */
function remakeIfGone(videoId: string): void {
  const found = sourceOf(videoId);
  if (!found) return;
  const { source, handle, project } = found;
  playbackDriver
    .find(source, handle)
    .then((made) => {
      if (made || projectStore.getState().project !== project || stateOf(videoId).kind !== 'made') return;
      setState(videoId, { kind: 'none' });
      makeCopy(videoId);
    })
    // The file can't be read now: the missing flag says so.
    .catch(() => undefined);
}

/** Takes the video's copy off the queue, or stops it being made; no copy is left half made. */
export function cancelCopy(videoId: string): void {
  const { waiting, making } = copiesStore.getState();
  if (waiting.includes(videoId)) {
    copiesStore.setState({ waiting: waiting.filter((id) => id !== videoId) });
    setState(videoId, { kind: 'none' });
    return;
  }
  if (making === videoId && current) {
    cancelled.add(videoId);
    setState(videoId, { kind: 'none' });
    void playbackDriver.cancel(current.source);
  }
}

/** A video relinked to another file: the copy of the old one doesn't play it, so its own is made. */
export function remakeCopy(videoId: string): void {
  cancelCopy(videoId);
  setState(videoId, UNKNOWN);
  makeCopy(videoId);
}

/** Looks for the video's copy now, unless it's on the queue (where it's known already). */
function lookUp(videoId: string): void {
  if (stateOf(videoId).kind === 'queued' || stateOf(videoId).kind === 'making') return;
  const found = sourceOf(videoId);
  if (!found) return;
  const { source, handle, project } = found;
  playbackDriver
    .find(source, handle)
    .then((made) => {
      const now = stateOf(videoId).kind;
      // Asked for meanwhile, or another project open: what the queue knows is newer.
      if (projectStore.getState().project !== project || now === 'queued' || now === 'making') return;
      // A failure stays until it's tried again: a copy not found only says there's none yet.
      if (!made && stateOf(videoId).kind === 'failed') return;
      setState(videoId, made ? { kind: 'made', silent: made.silent } : { kind: 'none' });
    })
    // A file that isn't there: the missing flag says so; there's no copy to speak of.
    .catch(() => {
      if (projectStore.getState().project === project && stateOf(videoId).kind === 'unknown') setState(videoId, { kind: 'none' });
    });
}

/**
 * After a Clear, a Move or a lower cap: what was known of each copy is looked for again. A failure stays, with its
 * words: its copy was never made, so none of those changed it.
 */
export function copiesChanged(): void {
  copiesStore.setState((s) => ({
    byVideo: Object.fromEntries(
      Object.entries(s.byVideo).filter(([, state]) => state.kind === 'queued' || state.kind === 'making' || state.kind === 'failed'),
    ),
  }));
}

let watching = false;

/** Another project opened: its copies are its own, and the last one's copy being made stops; once per page. */
function watch(): void {
  if (watching) return;
  watching = true;
  let project = projectStore.getState().project;
  projectStore.subscribe((state) => {
    if (state.project === project) return;
    project = state.project;
    const running = current;
    if (running) {
      cancelled.add(running.videoId);
      void playbackDriver.cancel(running.source);
    }
    copiesStore.setState({ byVideo: {}, waiting: [] });
  });
}

/**
 * The video's copy, looked for when it's first shown, each time it's shown again (as the cap can take it), and when
 * its file changes (an undo or a redo of a relink).
 */
export function useCopy(videoId: string | null): CopyState {
  watch();
  const state = useStore(copiesStore, (s) => (videoId ? (s.byVideo[videoId] ?? UNKNOWN) : UNKNOWN));
  const path = useStore(projectStore, (s) => {
    const record = videoId ? s.records[videoId] : undefined;
    return record?.type === 'media' ? (videoFields(record.props)?.sourcePath ?? null) : null;
  });
  useEffect(() => {
    if (videoId) lookUp(videoId);
  }, [videoId, path]);
  useEffect(() => (videoId ? showCopy(videoId) : undefined), [videoId]);
  // Cleared by a Clear or a Move while shown: looked for again.
  useEffect(() => {
    if (videoId && state.kind === 'unknown') lookUp(videoId);
  }, [videoId, state.kind]);
  return state;
}

/** What the queue is doing, for Settings → Storage: the video being made, how far along, and how many wait. */
export function useCopyQueue(): { making: string | null; done: number | null; waiting: number } {
  return useStore(
    copiesStore,
    useShallow((s) => {
      const state = s.making ? s.byVideo[s.making] : undefined;
      return { making: s.making, done: state?.kind === 'making' ? state.done : null, waiting: s.waiting.length };
    }),
  );
}
