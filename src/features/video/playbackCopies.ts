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
  /**
   * `silent`: made without the sound, as the original's couldn't be read; `quiet` too, because every sound track was
   * silent (nothing to try again).
   */
  | { kind: 'made'; silent: boolean; quiet?: boolean }
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

/**
 * The file each video's known state is about. A video whose file changes (a relink, its undo or redo) has its state
 * dropped and looked for again, and any copy being made of the other file stopped: that copy never plays it.
 */
const fileOf = new Map<string, string>();

/** A copy found or made, as a state. */
function madeState(made: { silent: boolean; quiet?: boolean }): CopyState {
  return { kind: 'made', silent: made.silent, ...(made.quiet ? { quiet: true } : {}) };
}

/** Whether the video still points at `path`: a result about another file is never kept as its own. */
function stillAt(videoId: string, path: string): boolean {
  return sourceOf(videoId)?.source.path === path;
}

/**
 * A result about a file the video doesn't point at now (it's in the Trash, say): not kept, and the video's copy is
 * looked for again when it's next shown.
 */
function forget(videoId: string): void {
  fileOf.delete(videoId);
  if (stateOf(videoId).kind === 'making') setState(videoId, UNKNOWN);
}

/** Sets the video's state, as being about `path`. */
function setAbout(videoId: string, path: string, state: CopyState): void {
  fileOf.set(videoId, path);
  setState(videoId, state);
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
  setAbout(videoId, source.path, { kind: 'making', done: null });
  playbackDriver
    .make(source, handle, (done) => {
      if (copiesStore.getState().making === videoId && !cancelled.has(videoId)) setState(videoId, { kind: 'making', done });
    })
    .then(
      (made) => {
        // Cancelled: Cancel said so already, and anything asked since (queued again, looked for) is newer.
        if (cancelled.has(videoId) || projectStore.getState().project !== project) return;
        if (!stillAt(videoId, source.path)) {
          forget(videoId);
          return;
        }
        setAbout(videoId, source.path, madeState(made));
        // Room for it may have come from older copies (the floor, the cap): those shown now are looked for again.
        for (const other of shown.keys()) if (other !== videoId) stillMade(other);
      },
      (error: unknown) => {
        if (cancelled.has(videoId) || projectStore.getState().project !== project) return;
        if (!stillAt(videoId, source.path)) {
          forget(videoId);
          return;
        }
        setAbout(videoId, source.path, { kind: 'failed', message: message(error) });
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
  // Whole, or without sound because every track is silent (made again, it would be the same).
  if (state.kind === 'made' && (!state.silent || state.quiet)) {
    remakeIfGone(videoId);
    return;
  }
  if (!sourceOf(videoId)) return;
  setState(videoId, { kind: 'queued' });
  copiesStore.setState((s) => ({ waiting: [...s.waiting, videoId] }));
  next();
}

/**
 * The video's copy to play (the Player, 2.4): where a `<video>` reads it, and whether it's without sound. Null when
 * there's none now (the cap or a Clear took it, or the copies are being moved).
 */
export async function copyToPlay(videoId: string): Promise<{ url: string; silent: boolean; quiet: boolean } | null> {
  const found = sourceOf(videoId);
  if (!found) return null;
  const made = await playbackDriver.find(found.source, found.handle);
  return made ? { url: playbackDriver.url(made), silent: made.silent, quiet: made.quiet === true } : null;
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
      if (!made && projectStore.getState().project === project && stillAt(videoId, source.path) && stateOf(videoId).kind === 'made')
        setAbout(videoId, source.path, { kind: 'none' });
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
      if (made || projectStore.getState().project !== project || !stillAt(videoId, source.path) || stateOf(videoId).kind !== 'made') return;
      setAbout(videoId, source.path, { kind: 'none' });
      makeCopy(videoId);
    })
    // The file can't be read now: the missing flag says so.
    .catch(() => undefined);
}

/**
 * The Player's <video> couldn't read the copy (2.4): made again only if it's gone. A copy there but without sound is
 * not made again for sound here, which could loop on a copy that loads and then fails.
 */
export function copyMayBeGone(videoId: string): void {
  watch();
  if (stateOf(videoId).kind === 'made') remakeIfGone(videoId);
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
      // About a file the video no longer points at: the look for its new one is newer.
      if (!stillAt(videoId, source.path)) return;
      // A failure stays until it's tried again: a copy not found only says there's none yet.
      if (!made && stateOf(videoId).kind === 'failed') return;
      setAbout(videoId, source.path, made ? madeState(made) : { kind: 'none' });
    })
    // A file that isn't there: the missing flag says so; there's no copy to speak of.
    .catch(() => {
      if (projectStore.getState().project === project && stillAt(videoId, source.path) && stateOf(videoId).kind === 'unknown')
        setAbout(videoId, source.path, { kind: 'none' });
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
  let records = projectStore.getState().records;
  projectStore.subscribe((state) => {
    if (state.project !== project) {
      project = state.project;
      records = state.records;
      const running = current;
      if (running) {
        cancelled.add(running.videoId);
        void playbackDriver.cancel(running.source);
      }
      fileOf.clear();
      copiesStore.setState({ byVideo: {}, waiting: [] });
      return;
    }
    if (state.records === records) return;
    records = state.records;
    for (const [videoId, path] of [...fileOf]) {
      // In the Trash (or gone): not another file, so its copy carries on; a result is kept only once it's back.
      const now = sourceOf(videoId);
      if (!now || now.source.path === path) continue;
      fileChanged(videoId);
    }
  });
}

/**
 * The video now points at another file (a relink, or an undo or redo of one). A copy being made of the old file is
 * stopped and made again of the new one; anything else known is dropped, to be looked for again.
 */
function fileChanged(videoId: string): void {
  fileOf.delete(videoId);
  const running = current?.videoId === videoId ? current : null;
  if (running) {
    cancelled.add(videoId);
    void playbackDriver.cancel(running.source);
    setState(videoId, UNKNOWN);
    makeCopy(videoId);
    return;
  }
  if (stateOf(videoId).kind !== 'queued') setState(videoId, UNKNOWN);
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
    // Null in the Trash, so a restore counts as a change and the copy is looked for again.
    return record?.type === 'media' && record.trashedAt === null ? (videoFields(record.props)?.sourcePath ?? null) : null;
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
