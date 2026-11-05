import { ask } from '../../app/ask';
import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { videoDriver, type VideoFile } from '../../app/video';
import { localizeError, t, tn, type MessageKey } from '../../core/i18n';
import { frameTimecode, rateValue, type Rational } from '../../core/media/timecode';
import { readClip, relinkChange, videoFields, type VideoFields, type VideoProbe } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import { checkVideos } from './videoStatus';

// Relink (2.2b, CLAUDE.md: flag missing media and offer relink): point a video record at its file again, after it
// moved or on another computer. One op, so undo puts the old path back; the frames that play the video, its poster and
// its LUT stay. In and out points are frame numbers, so a file that might not be the same clip (another rate, length,
// name, size or start timecode) is asked about first.

type Records = Readonly<Record<string, SbdRecord>>;

/** "23.976", "29.97", "25": a rate as a slate or camera menu writes it. */
export function fpsLabel(rate: Rational): string {
  return String(Number(rateValue(rate).toFixed(3)));
}

export interface Mismatch {
  rate: boolean;
  length: boolean;
  /** The name, the size (when both are known) or the start timecode: maybe another take. */
  file: boolean;
}

/** What differs between the linked video and a file offered in its place; null when nothing does. */
export function relinkMismatch(linked: VideoFields, probe: VideoProbe, file: { name: string; size?: number | null }): Mismatch | null {
  const rate = linked.fps.num * probe.fpsDen !== probe.fpsNum * linked.fps.den;
  const length = linked.durationFrames !== probe.durationFrames;
  const size = linked.sourceSize !== null && file.size !== undefined && file.size !== null && linked.sourceSize !== file.size;
  const named = linked.sourceName !== '' && linked.sourceName !== file.name;
  const timecode = linked.startTimecode !== probe.startTimecode;
  const other = size || named || timecode;
  return rate || length || other ? { rate, length, file: other } : null;
}

/** The question's title: the most telling difference. */
export function mismatchTitle(mismatch: Mismatch): MessageKey {
  return mismatch.rate ? 'relink.differentRate' : mismatch.length ? 'relink.differentLength' : 'relink.differentFile';
}

/** Live frames whose clip of this video would run past the end of a file `frames` long. */
export function clipsPastEnd(records: Records, videoId: string, frames: number): number {
  let count = 0;
  for (const r of Object.values(records)) {
    if (r.type !== 'shot' || r.trashedAt !== null) continue;
    const clip = readClip(r.props);
    if (clip?.videoId === videoId && clip.outFrame >= frames) count++;
  }
  return count;
}

/** The video, if it's still there and not in the Trash. */
function liveVideo(records: Records, videoId: string): VideoFields | null {
  const record = records[videoId];
  return record && record.trashedAt === null ? videoFields(record.props) : null;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function sizeOf(file: VideoFile, handle: number | undefined): Promise<number | null> {
  if (file.size !== undefined) return file.size;
  if (!file.path) return null;
  return (await videoDriver.status([file.path], handle))[0]?.size ?? null;
}

/** Asks for the video's file, checks it, and relinks. */
export async function relinkVideo(videoId: string): Promise<void> {
  const { project, records } = projectStore.getState();
  const linked = liveVideo(records, videoId);
  if (!project || !linked) return;
  const handle = project.file.nativeHandle;
  try {
    const [file] = await videoDriver.choose(false);
    if (!file) return;
    const probe = await videoDriver.probe(file, handle);
    const size = await sizeOf(file, handle);
    const mismatch = relinkMismatch(linked, probe, { name: file.name, size });
    if (mismatch) {
      const rate = { num: probe.fpsNum, den: probe.fpsDen };
      const past = clipsPastEnd(projectStore.getState().records, videoId, probe.durationFrames);
      const text = [
        t('relink.compare', {
          name: file.name,
          frames: tn('count.frames', probe.durationFrames),
          fps: fpsLabel(rate),
          start: frameTimecode(0, rate, probe.startTimecode),
          linkedName: linked.sourceName,
          linkedFrames: tn('count.frames', linked.durationFrames),
          linkedFps: fpsLabel(linked.fps),
          linkedStart: frameTimecode(0, linked.fps, linked.startTimecode),
        }),
        ...(past > 0 ? [tn('relink.pastEnd', past)] : []),
      ].join(' ');
      const answer = await ask({
        title: t(mismatchTitle(mismatch)),
        text,
        choices: [
          { id: 'cancel', label: t('common.cancel') },
          { id: 'relink', label: t('relink.anyway'), variant: 'primary' },
        ],
        cancel: 'cancel',
      });
      if (answer !== 'relink') return;
    }
    // The project may have closed, or the video gone to the Trash, while the dialogs were up.
    if (projectStore.getState().project !== project || !liveVideo(projectStore.getState().records, videoId)) return;
    const source = { name: file.name, ...(file.path ? { path: file.path } : {}), ...(size !== null ? { size } : {}) };
    await projectStore.getState().apply([relinkChange(videoId, probe, source, project.file.path)]);
    await checkVideos();
  } catch (error) {
    showNotice(localizeError(reason(error)));
  }
}
