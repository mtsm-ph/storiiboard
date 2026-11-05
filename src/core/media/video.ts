import type { JsonValue, Props } from '../model/record';
import type { Change } from '../ops/ops';
import { cropProp, isDefaultCrop, readCrop, type Crop } from './crop';
import { relativeToProject } from './store';
import { frameTimecode, type Rational } from './timecode';

// Videos (Phase 2, schema 8, docs/SBD_FORMAT.md). A video is a `media` record of kind `video` under the project: a
// pointer to the original, which stays outside the .sbd (CLAUDE.md), and what ffprobe read from it. A frame plays part
// of one through its `clip` prop, and a picture grabbed from one says where it came from in `from_video`, so the same
// frame can be grabbed again after the video is relinked or its LUT changes.

/** What ffprobe reads from a file (src-tauri/src/video.rs, Probe), or the browser build's stand-in. */
export interface VideoProbe {
  codec: string;
  width: number;
  height: number;
  sarNum: number;
  sarDen: number;
  fpsNum: number;
  fpsDen: number;
  durationFrames: number;
  startTimecode: string | null;
  /** Degrees clockwise to show it upright: 0, 90, 180 or 270. */
  rotation: number;
  hasAudio: boolean;
  hdr: boolean;
  bitDepth: number;
}

/** Where the original is, as the person handed it over. */
export interface VideoSource {
  /** `A001_C003_0101AB.MP4`: the clip's file name, as editors and the camera report call it. */
  name: string;
  /** Absolute, as dropped or chosen; stored relative to the .sbd when it's under the project's folder. */
  path?: string;
  /** Bytes, to tell the same clip from another with its name when relinking. */
  size?: number;
}

export interface VideoFields {
  sourceName: string;
  /** As stored: relative to the .sbd's folder, or absolute. '' when the browser build linked it without a path. */
  sourcePath: string;
  sourceSize: number | null;
  durationFrames: number;
  fps: Rational;
  /** As the source writes it: "01:00:00:00", or "01:00:00;00" for drop-frame; null when it has none. */
  startTimecode: string | null;
  width: number;
  height: number;
  /** The pixel shape: 1/1 square, 4/3 for HDV, 2/1 for a 2x anamorphic. */
  sar: Rational;
  rotation: 0 | 90 | 180 | 270;
  codec: string;
  hasAudio: boolean;
  hdr: boolean;
  bitDepth: number;
  /**
   * The id of an image `media` record under the video: a still shown for it where there's no frame yet. A record, not
   * a hash, so Empty Trash and Clean up old pictures count its picture as used like any other.
   */
  poster: string | null;
  /** A row of the `luts` table (2.5); null for none. */
  lutId: string | null;
}

function wholeNumber(value: JsonValue | undefined, min = 0): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : null;
}

function rational(value: JsonValue | undefined): Rational | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const num = wholeNumber(value.num, 1);
  const den = wholeNumber(value.den, 1);
  return num !== null && den !== null ? { num, den } : null;
}

function rationalProp(rate: Rational): { num: number; den: number } {
  return { num: rate.num, den: rate.den };
}

const ROTATIONS = [0, 90, 180, 270] as const;

/** The props of a new video record. */
export function videoProps(probe: VideoProbe, source: VideoSource, projectPath: string, poster: string | null): Props {
  const rotation = ROTATIONS.find((r) => r === probe.rotation) ?? 0;
  return {
    kind: 'video',
    source_name: source.name,
    ...(source.path ? { source_path: projectPath ? relativeToProject(source.path, projectPath) : source.path } : {}),
    ...(source.size !== undefined ? { source_size: source.size } : {}),
    duration_frames: probe.durationFrames,
    fps: rationalProp({ num: probe.fpsNum, den: probe.fpsDen }),
    ...(probe.startTimecode ? { start_timecode: probe.startTimecode } : {}),
    width: probe.width,
    height: probe.height,
    sar: rationalProp({ num: probe.sarNum || 1, den: probe.sarDen || 1 }),
    rotation,
    codec: probe.codec,
    has_audio: probe.hasAudio,
    hdr: probe.hdr,
    bit_depth: probe.bitDepth,
    ...(poster ? { poster } : {}),
  };
}

/** Props a video's file decides, so a relink can take off what the new file doesn't have. */
const FILE_PROPS = ['source_path', 'source_size', 'start_timecode'] as const;

/**
 * The edit a relink makes: where the file is and what was read from it. Everything else the record holds (its LUT,
 * its poster) stays, and so do the frames that play it.
 */
export function relinkChange(videoId: string, probe: VideoProbe, source: VideoSource, projectPath: string): Change {
  const set = videoProps(probe, source, projectPath, null);
  return { kind: 'update', id: videoId, set, unset: FILE_PROPS.filter((key) => !(key in set)) };
}

/** A video record's fields, or null when it isn't a video (another kind, or props it can't read). */
export function videoFields(props: Props): VideoFields | null {
  if (props.kind !== 'video') return null;
  const fps = rational(props.fps);
  const width = wholeNumber(props.width, 1);
  const height = wholeNumber(props.height, 1);
  const duration = wholeNumber(props.duration_frames);
  if (!fps || width === null || height === null || duration === null) return null;
  return {
    sourceName: typeof props.source_name === 'string' ? props.source_name : '',
    sourcePath: typeof props.source_path === 'string' ? props.source_path : '',
    sourceSize: wholeNumber(props.source_size),
    durationFrames: duration,
    fps,
    startTimecode: typeof props.start_timecode === 'string' && props.start_timecode !== '' ? props.start_timecode : null,
    width,
    height,
    sar: rational(props.sar) ?? { num: 1, den: 1 },
    rotation: ROTATIONS.find((r) => r === props.rotation) ?? 0,
    codec: typeof props.codec === 'string' ? props.codec : '',
    hasAudio: props.has_audio === true,
    hdr: props.hdr === true,
    bitDepth: wholeNumber(props.bit_depth, 1) ?? 8,
    poster: typeof props.poster === 'string' && props.poster !== '' ? props.poster : null,
    lutId: typeof props.lut === 'string' && props.lut !== '' ? props.lut : null,
  };
}

/** The shape the picture shows in, once turned upright and its pixels made square: what a frame crops. */
export function displayAspect(video: VideoFields): number {
  const wide = (video.width * video.sar.num) / video.sar.den;
  return video.rotation === 90 || video.rotation === 270 ? video.height / wide : wide / video.height;
}

/** The absolute path of a stored one: relative paths are under the .sbd's folder. */
export function resolveSourcePath(stored: string, projectPath: string): string {
  if (stored === '' || /^([a-zA-Z]:[\\/]|[\\/])/.test(stored)) return stored;
  const separator = projectPath.includes('\\') && !projectPath.includes('/') ? '\\' : '/';
  const folder = projectPath.split(/[/\\]/).slice(0, -1);
  return [...folder, ...stored.split('/')].join(separator);
}

/**
 * The part of a video a frame plays: frames `inFrame` to `outFrame`, both included, at the video's rate, framed by
 * `crop` (2.6; the frame-picture crop model of 1.11). The frame's picture keeps its own crop.
 */
export interface Clip {
  videoId: string;
  inFrame: number;
  outFrame: number;
  crop: Crop;
}

/** A frame's `clip` prop as stored; the centred crop is stored as none. */
export function clipProp(clip: Clip): Props {
  return {
    video_id: clip.videoId,
    in_frame: clip.inFrame,
    out_frame: clip.outFrame,
    ...(isDefaultCrop(clip.crop) ? {} : { crop: cropProp(clip.crop) }),
  };
}

/** A shot's clip, or null when it has none or its prop can't be read. */
export function readClip(props: Props): Clip | null {
  const clip = props.clip;
  if (typeof clip !== 'object' || clip === null || Array.isArray(clip)) return null;
  const inFrame = wholeNumber(clip.in_frame);
  const outFrame = wholeNumber(clip.out_frame);
  if (typeof clip.video_id !== 'string' || clip.video_id === '' || inFrame === null || outFrame === null) return null;
  if (outFrame < inFrame) return null;
  return { videoId: clip.video_id, inFrame, outFrame, crop: readCrop(clip) };
}

/** Where a picture grabbed from a video came from: enough to grab the same frame again. */
export interface FromVideo {
  videoId: string;
  frame: number;
  fps: Rational;
  /** The frame's source timecode, as on the slate and in the edit. */
  timecode: string;
  sourceName: string;
  lutId: string | null;
  lutName: string | null;
}

/** The `from_video` prop of a picture grabbed from frame `frame` of a video, with the LUT it was graded with. */
export function fromVideoProp(videoId: string, video: VideoFields, frame: number, lut: { id: string; name: string } | null): Props {
  return {
    video_id: videoId,
    frame,
    fps: rationalProp(video.fps),
    timecode: frameTimecode(frame, video.fps, video.startTimecode),
    source_name: video.sourceName,
    lut_id: lut?.id ?? null,
    lut_name: lut?.name ?? null,
  };
}

/** A picture's `from_video`, or null when it wasn't grabbed from a video. */
export function readFromVideo(props: Props): FromVideo | null {
  const from = props.from_video;
  if (typeof from !== 'object' || from === null || Array.isArray(from)) return null;
  const frame = wholeNumber(from.frame);
  const fps = rational(from.fps);
  if (typeof from.video_id !== 'string' || frame === null || !fps) return null;
  return {
    videoId: from.video_id,
    frame,
    fps,
    timecode: typeof from.timecode === 'string' ? from.timecode : '',
    sourceName: typeof from.source_name === 'string' ? from.source_name : '',
    lutId: typeof from.lut_id === 'string' ? from.lut_id : null,
    lutName: typeof from.lut_name === 'string' ? from.lut_name : null,
  };
}

/** File types offered when browsing for a video, and recognised in a drop. RAW formats need a maker's SDK. */
export const VIDEO_EXTENSIONS = ['mov', 'mp4', 'm4v', 'mxf', 'mts', 'm2ts', 'ts', 'mkv', 'avi', 'webm', 'mpg', 'mpeg', '3gp'] as const;

export function isVideoName(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extension);
}
