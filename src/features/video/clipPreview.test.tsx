import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClipPreview, type ClipPreviewProps } from './ClipPreview';

// The frame's clip in the inspector (2.8): framed as the frame is, muted, still until Play clip.

const props: ClipPreviewProps = {
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
    expect(html).toMatch(/aria-pressed="false"[^>]*>Play clip</);
  });

  it('offers nothing to play until there’s a copy', () => {
    const html = render({ url: null });
    expect(html).not.toContain('<video');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Play clip</);
  });
});
