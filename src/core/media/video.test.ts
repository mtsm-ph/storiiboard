import { describe, expect, it } from 'vitest';
import {
  clipProp,
  displayAspect,
  fromVideoProp,
  isVideoName,
  readClip,
  readFromVideo,
  relinkChange,
  resolveSourcePath,
  videoFields,
  videoProps,
  type VideoProbe,
} from './video';

const fx3: VideoProbe = {
  codec: 'h264',
  width: 3840,
  height: 2160,
  sarNum: 1,
  sarDen: 1,
  fpsNum: 24000,
  fpsDen: 1001,
  durationFrames: 1440,
  startTimecode: '01:02:03:04',
  rotation: 0,
  hasAudio: true,
  hdr: false,
  bitDepth: 10,
};

const poster = 'b'.repeat(64);

describe('video records', () => {
  it('keep what ffprobe read, with the rate as an exact fraction and the path relative to the project', () => {
    const props = videoProps(fx3, { name: 'C0042.MP4', path: '/Films/Bey County/Footage/C0042.MP4', size: 1234 }, '/Films/Bey County/Bey County.sbd', poster);
    expect(props).toEqual({
      kind: 'video',
      source_name: 'C0042.MP4',
      source_path: 'Footage/C0042.MP4',
      source_size: 1234,
      duration_frames: 1440,
      fps: { num: 24000, den: 1001 },
      start_timecode: '01:02:03:04',
      width: 3840,
      height: 2160,
      sar: { num: 1, den: 1 },
      rotation: 0,
      codec: 'h264',
      has_audio: true,
      hdr: false,
      bit_depth: 10,
      poster,
    });
    const fields = videoFields(props);
    expect(fields).toMatchObject({ fps: { num: 24000, den: 1001 }, startTimecode: '01:02:03:04', sourcePath: 'Footage/C0042.MP4', poster, lutId: null });
    expect(videoFields({ kind: 'image', file: poster, width: 10, height: 10 })).toBeNull();
    expect(videoFields({ kind: 'video', fps: { num: 0, den: 1 }, width: 10, height: 10, duration_frames: 1 })).toBeNull();
  });

  it('keep an absolute path for a file outside the project folder', () => {
    const props = videoProps(fx3, { name: 'C0042.MP4', path: 'D:\\Cards\\A001\\C0042.MP4' }, 'C:\\Films\\Bey County.sbd', null);
    expect(props.source_path).toBe('D:\\Cards\\A001\\C0042.MP4');
    expect(props).not.toHaveProperty('poster');
  });

  it('resolve a relative path against the project, on a Mac and on Windows', () => {
    expect(resolveSourcePath('Footage/C0042.MP4', '/Films/Bey County/Bey County.sbd')).toBe('/Films/Bey County/Footage/C0042.MP4');
    expect(resolveSourcePath('Footage/C0042.MP4', 'C:\\Films\\Bey County.sbd')).toBe('C:\\Films\\Footage\\C0042.MP4');
    expect(resolveSourcePath('D:\\Cards\\C0042.MP4', 'C:\\Films\\Bey County.sbd')).toBe('D:\\Cards\\C0042.MP4');
    expect(resolveSourcePath('/Volumes/A001/C0042.MP4', '/Films/Bey County.sbd')).toBe('/Volumes/A001/C0042.MP4');
  });

  it('show anamorphic and phone footage the shape it plays at', () => {
    const fields = (probe: Partial<VideoProbe>) => videoFields(videoProps({ ...fx3, ...probe }, { name: 'x.mov' }, '', null));
    const hdv = fields({ width: 1440, height: 1080, sarNum: 4, sarDen: 3 });
    expect(hdv && displayAspect(hdv)).toBeCloseTo(16 / 9);
    const phone = fields({ width: 1920, height: 1080, rotation: 90 });
    expect(phone && displayAspect(phone)).toBeCloseTo(9 / 16);
  });

  it('relink to a new file, taking off what the new one lacks and keeping the LUT and poster', () => {
    const change = relinkChange('v', { ...fx3, startTimecode: null }, { name: 'C0042.MP4', path: '/Cards/C0042.MP4' }, '/Films/Bey County.sbd');
    expect(change).toMatchObject({ kind: 'update', id: 'v', set: { source_path: '/Cards/C0042.MP4' }, unset: ['source_size', 'start_timecode'] });
    if (change.kind !== 'update') throw new Error('an update');
    expect(change.set).not.toHaveProperty('poster');
    expect(change.set).not.toHaveProperty('lut');
  });
});

describe('clips and grabbed pictures', () => {
  it('read a frame’s clip back, and refuse one that runs backwards', () => {
    const clip = { videoId: 'v', inFrame: 24, outFrame: 96 };
    expect(readClip({ clip: clipProp(clip) })).toEqual(clip);
    expect(readClip({ clip: { video_id: 'v', in_frame: 96, out_frame: 24 } })).toBeNull();
    expect(readClip({ clip: { video_id: 'v', in_frame: 1.5, out_frame: 24 } })).toBeNull();
    expect(readClip({})).toBeNull();
  });

  it('record the frame, its timecode and the LUT a picture was grabbed with', () => {
    const video = videoFields(videoProps(fx3, { name: 'C0042.MP4' }, '', null));
    if (!video) throw new Error('a video');
    const prop = fromVideoProp('v', video, 24, { id: 'l', name: 'S-Log3 to 709' });
    expect(prop).toEqual({
      video_id: 'v',
      frame: 24,
      fps: { num: 24000, den: 1001 },
      timecode: '01:02:04:04',
      source_name: 'C0042.MP4',
      lut_id: 'l',
      lut_name: 'S-Log3 to 709',
    });
    expect(readFromVideo({ from_video: prop })).toEqual({
      videoId: 'v',
      frame: 24,
      fps: { num: 24000, den: 1001 },
      timecode: '01:02:04:04',
      sourceName: 'C0042.MP4',
      lutId: 'l',
      lutName: 'S-Log3 to 709',
    });
    expect(readFromVideo({ from_video: fromVideoProp('v', video, 0, null) })).toMatchObject({ lutId: null, lutName: null });
  });

  it('tell a video file by its name', () => {
    expect(isVideoName('A001_C003.MOV')).toBe(true);
    expect(isVideoName('00001.MTS')).toBe(true);
    expect(isVideoName('still.jpg')).toBe(false);
    expect(isVideoName('clip.R3D')).toBe(false);
  });
});
