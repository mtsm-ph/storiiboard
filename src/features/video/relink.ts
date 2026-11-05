import { ask } from '../../app/ask';
import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { videoDriver } from '../../app/video';
import { localizeError, t } from '../../core/i18n';
import { rateValue, type Rational } from '../../core/media/timecode';
import { relinkChange, videoFields, type VideoFields, type VideoProbe } from '../../core/media/video';
import { checkVideos } from './videoStatus';

// Relink (2.2b, CLAUDE.md: flag missing media and offer relink): point a video record at its file again, after it
// moved or on another computer. One op, so undo puts the old path back; the frames that play the video, its poster and
// its LUT stay. In and out points are frame numbers, so a file with another rate or length is asked about first.

/** "23.976", "29.97", "25": a rate as a slate or camera menu writes it. */
export function fpsLabel(rate: Rational): string {
  return String(Number(rateValue(rate).toFixed(3)));
}

/** What differs between the linked video and a file offered in its place: its rate, or its length; null when neither. */
export function relinkMismatch(linked: VideoFields, probe: VideoProbe): { rate: boolean; length: boolean } | null {
  const rate = linked.fps.num * probe.fpsDen !== probe.fpsNum * linked.fps.den;
  const length = linked.durationFrames !== probe.durationFrames;
  return rate || length ? { rate, length } : null;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Asks for the video's file, checks it, and relinks. */
export async function relinkVideo(videoId: string): Promise<void> {
  const { project } = projectStore.getState();
  const linked = videoFields(projectStore.getState().records[videoId]?.props ?? {});
  if (!project || !linked) return;
  const handle = project.file.nativeHandle;
  try {
    const [file] = await videoDriver.choose(false);
    if (!file) return;
    const probe = await videoDriver.probe(file, handle);
    const mismatch = relinkMismatch(linked, probe);
    if (mismatch) {
      const answer = await ask({
        title: t('relink.differentTitle'),
        text: t('relink.differentText', {
          name: file.name,
          frames: probe.durationFrames,
          fps: fpsLabel({ num: probe.fpsNum, den: probe.fpsDen }),
          linkedName: linked.sourceName,
          linkedFrames: linked.durationFrames,
          linkedFps: fpsLabel(linked.fps),
        }),
        choices: [
          { id: 'cancel', label: t('common.cancel') },
          { id: 'relink', label: t('relink.anyway'), variant: 'primary' },
        ],
        cancel: 'cancel',
      });
      if (answer !== 'relink') return;
    }
    const size = file.size ?? (file.path ? ((await videoDriver.status([file.path], handle))[0]?.size ?? null) : null);
    // The project may have closed, or the video gone to the Trash, while the dialog was up.
    if (projectStore.getState().project !== project || !videoFields(projectStore.getState().records[videoId]?.props ?? {})) return;
    const source = { name: file.name, ...(file.path ? { path: file.path } : {}), ...(size !== null ? { size } : {}) };
    await projectStore.getState().apply([relinkChange(videoId, probe, source, project.file.path)]);
    await checkVideos();
  } catch (error) {
    showNotice(localizeError(reason(error)));
  }
}
