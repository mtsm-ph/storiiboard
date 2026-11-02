import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  const html = renderToString(<App />);

  it('names the app in a heading for screen readers', () => {
    expect(html).toMatch(/<h1[^>]*>Storiiboard<\/h1>/);
  });

  it('opens on the Storyboard workspace with its four tiles', () => {
    expect(html).toMatch(/aria-selected="true"[^>]*>Storyboard</);
    for (const tile of ['Scenes', 'Storyboard', 'Frame inspector', 'Player']) {
      expect(html).toContain(`aria-label="${tile}"`);
    }
  });
});
