import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sceneFields } from '../../core/model/storyboard';
import { headingOf, sceneSummary, ScenesView, type SceneRow } from './ScenesView';

const noop = () => undefined;
const row = (id: string, props: Record<string, string | number | boolean>, frames = 0, coverage: number | null = null): SceneRow => ({
  id,
  fields: sceneFields(props),
  frames,
  coverage,
});

describe('the Scenes tile', () => {
  it('writes headings as the script does, once INT/EXT or DAY/NIGHT is known', () => {
    expect(headingOf(sceneFields({ number: '4', name: 'Penn Station', int_ext: 'INT', day_night: 'DAY' }))).toBe(
      'INT. PENN STATION — DAY',
    );
    expect(headingOf(sceneFields({ number: '5', name: 'Dock at dawn' }))).toBe('Dock at dawn');
    expect(headingOf(sceneFields({ number: '6' }))).toBe('Untitled');
  });

  it('sums each scene up: length, frames, and how much is in hand', () => {
    expect(sceneSummary(row('a', { number: '4', page_eighths: 11 }, 6, 67))).toBe('1 3/8 pg · 6 fr · 67%');
    expect(sceneSummary(row('b', { number: '5' }, 4, 100))).toBe('— · 4 fr · done');
    expect(sceneSummary(row('c', { number: '6' }))).toBe('— · 0 fr');
  });

  it('marks the active scene with the accent and a bold heading, and each lock with its state', () => {
    const html = renderToString(
      <ScenesView
        scenes={[row('sc4', { number: '4', name: 'Penn Station', page_eighths: 11, numbers_locked: true }, 6, 67), row('sc5', { number: '5', page_eighths: 6 })]}
        activeSceneId="sc4"
        coverage={41}
        canAdd
        onSelect={noop}
        onToggleLock={noop}
        onAdd={noop}
        onImport={noop}
      />,
    );
    expect(html.split('bg-accent').length - 1).toBe(1);
    expect(html).toMatch(/font-bold[^>]*>Penn Station/);
    expect(html).toMatch(/aria-pressed="true" aria-label="Lock shot numbers for SC 04"/);
    expect(html).toMatch(/aria-pressed="false" aria-label="Lock shot numbers for SC 05"/);
    // 11 + 6 eighths = 2 1/8 pages across the board.
    expect(html).toContain('2 1/8 pg');
    expect(html).toContain('41%');
  });
});
