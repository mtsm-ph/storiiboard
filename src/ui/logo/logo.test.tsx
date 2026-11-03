import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SMark, SMALL_MARK_MAX } from './SMark';
import { Wordmark } from './Wordmark';

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('SMark', () => {
  it('drops the inline and rings at 32px and below', () => {
    for (const size of [16, 24, SMALL_MARK_MAX]) {
      const html = renderToString(<SMark size={size} />);
      expect(count(html, '<circle')).toBe(2);
      expect(count(html, '<path')).toBe(1);
    }
  });

  it('draws the full mark, inline and rings, above 32px', () => {
    const html = renderToString(<SMark size={SMALL_MARK_MAX + 1} />);
    expect(count(html, '<circle')).toBe(4);
    expect(count(html, '<path')).toBe(2);
  });

  it('keeps the dots orange and lets the inline match the background', () => {
    const html = renderToString(<SMark size={96} inline="var(--surface)" />);
    expect(count(html, 'fill-brand')).toBe(4);
    expect(html).toContain('stroke:var(--surface)');
  });

  it('is an image named Storiiboard unless marked decorative', () => {
    expect(renderToString(<SMark />)).toContain('aria-label="Storiiboard"');
    const decorative = renderToString(<SMark decorative />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role="img"');
  });
});

describe('Wordmark', () => {
  it('has nine ink letters and two orange I bars with their dots', () => {
    const html = renderToString(<Wordmark />);
    expect(count(html, 'class="fill-text"')).toBe(9);
    expect(count(html, '<rect')).toBe(2);
    expect(count(html, '<circle')).toBe(2);
    expect(count(html, 'fill-brand')).toBe(4);
  });

  it('never carries the S mark', () => {
    expect(renderToString(<Wordmark />)).not.toContain('M79 33');
  });
});
