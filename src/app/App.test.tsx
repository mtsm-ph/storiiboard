import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  const html = renderToString(<App />);

  it('names the app in a heading for screen readers', () => {
    expect(html).toMatch(/<h1[^>]*>Storiiboard<\/h1>/);
  });

  it('opens on the Storyboard workspace with its four tiles', () => {
    expect(html).toMatch(/aria-current="page"[^>]*>Storyboard</);
    for (const tile of ['Scenes', 'Storyboard', 'Frame inspector', 'Player']) {
      expect(html).toContain(`aria-label="${tile}"`);
    }
  });

  it('lists the seven sections in the sidebar, each with its phase until built', () => {
    const nav = /<nav[^>]*aria-label="Sections".*<\/nav>/.exec(html)?.[0] ?? '';
    const sections = [...nav.matchAll(/id="section-([a-z]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(['storyboard', 'assets', 'team', 'setup', 'production', 'moodboard', 'settings']);
    expect(nav).toContain('Phase 5');
    expect(nav).toContain('No project open');
  });
});
