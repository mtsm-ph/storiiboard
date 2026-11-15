import { t } from '../../../core/i18n';
import { cameraSetupFrames, cameraTitle, frameCamera, setupCameras, shownFrame } from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { setupLabel } from '../../../core/model/setup';
import { aspectRatioValue, projectStoryboard, SHOT_SIZE_LABEL, shotFields } from '../../../core/model/storyboard';
import type { FramePictureView } from '../../storyboard/FrameImage';
import { pictureView } from '../../storyboard/framePictures';
import { iconLabel } from './iconWords';

// What the Frames tile (6.4) shows of a setup, read from the records as plain data (6.11), so a reading that comes out
// the same after an edit (a light turned, a wall's length typed: nothing the tile shows) is kept as the very same object,
// and the tile's list is never drawn again for it. The selection is the tile's own, read apart.

type Records = Readonly<Record<string, SbdRecord>>;

export interface FrameRow {
  id: string;
  parentId: string | null;
  /** Its shot number, as the slate has it. */
  number: string;
  /** "MCU · 35 mm", or ''. */
  spec: string;
  picture: FramePictureView | null;
  /** The camera that shoots it, or null. */
  holder: string | null;
  /** It is its camera's shown frame. */
  shown: boolean;
}

export interface FramesReading {
  /** The setup's name, "Setup 2 · Wide". */
  name: string;
  aspect: number;
  cameras: readonly { id: string; title: string }[];
  rows: readonly FrameRow[];
}

/** A setup's frames in board order, each with its picture, number, size and lens and who shoots it, and the setup's cameras. */
export function framesReading(records: Records, projectId: string, setup: SbdRecord, number: number): FramesReading {
  const frames = cameraSetupFrames(records, setup.id);
  const cameras = setupCameras(records, setup.id).map((c) => ({ id: c.record.id, title: cameraTitle(records, c.record.id, iconLabel) }));
  const rows = frames.map((shot): FrameRow => {
    const fields = shotFields(shot.props);
    const holder = frameCamera(records, shot.id);
    const spec = [fields.size ? SHOT_SIZE_LABEL[fields.size] : null, fields.lensMm === null ? null : t('lens.prime', { mm: fields.lensMm })].filter((p) => p !== null).join(' · ');
    return {
      id: shot.id,
      parentId: shot.parentId,
      number: fields.number,
      spec,
      picture: pictureView(records, fields),
      holder,
      shown: holder !== null && shownFrame(records, holder)?.id === shot.id,
    };
  });
  return {
    name: setupLabel({ number, fields: { name: typeof setup.props.name === 'string' ? setup.props.name.trim() : '' } }),
    aspect: aspectRatioValue(projectStoryboard(records[projectId]?.props).aspectRatio),
    cameras,
    rows,
  };
}

/** framesReading, kept between calls: the same object back while it reads the same, word for word. */
export function framesReadingKeeper(): (records: Records, projectId: string, setup: SbdRecord, number: number) => FramesReading {
  let last: { text: string; reading: FramesReading } | null = null;
  return (records, projectId, setup, number) => {
    const reading = framesReading(records, projectId, setup, number);
    const text = JSON.stringify(reading);
    if (last?.text === text) return last.reading;
    last = { text, reading };
    return reading;
  };
}
