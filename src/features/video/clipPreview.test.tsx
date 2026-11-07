import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClipPreview, type ClipPreviewProps } from './ClipPreview';

// The frame's clip in the inspector (2.8): framed as the frame is, muted, still until Play clip.

const props: ClipPreviewProps = {
  videoId: 'v1',
  frameKey: 's1',
  url: 'sbdcopy://localhost/copy.mp4',
  inFrame: 24,
  outFrame: 47,
  fps: { num: 24, den: 1 },
  crop: { x: 0.5, y: 0.5, zoom: 2 },
  imageAspect: 16 / 9,
  frameAspect: 16 / 9,
};
const render = (extra: Partial<ClipPreviewProps> = {}) => renderToString(<ClipPreview {...props} {...extra} />);

describe('the frame’s clip in the inspector (2.8)', () => {
  it('plays the copy muted, framed by the clip’s crop, in a box of the frame’s shape, never by itself', () => {
    const html = render();
    expect(html).toContain('src="sbdcopy://localhost/copy.mp4"');
    expect(html).toMatch(/<video[^>]*muted=""/);
    expect(html).not.toMatch(/<video[^>]*autoplay/i);
    expect(html).not.toContain(' controls');
    // Zoom 2, centred: the picture twice the frame, a quarter of it off each edge.
    expect(html).toMatch(/style="left:-50%;top:-50%;width:200%;height:200%"/);
    expect(html).toMatch(/aspect-ratio:1\.77/);
    expect(html).toMatch(/<button[^>]*>Play clip</);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Play clip</);
  });

  it('has nothing to play for a clip of one frame', () => {
    expect(render({ inFrame: 30, outFrame: 30 })).toMatch(/<button[^>]*disabled=""[^>]*>Play clip</);
  });
});
