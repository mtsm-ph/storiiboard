import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SbdRecord } from '../../core/model/record';
import { boardScene } from './board';
import { moveTarget } from './StoryboardTile';
import { countsLine, StoryboardView, type SceneGroup } from './StoryboardView';

const noop = () => undefined;
const record = (id: string, type: 'scene' | 'shot', parentId: string, sortKey: string, props = {}): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: '',
  updatedAt: '',
});

describe('the storyboard grid', () => {
  it('counts a scene’s frames by status, leaving out what’s zero', () => {
    expect(countsLine({ have: 4, need: 1, source: 0 })).toBe('4 have · 1 need');
    expect(countsLine({ have: 0, need: 0, source: 0 })).toBe('');
  });

  it('marks the selected frame with the accent and an ink chip, and makes it the one Tab stop', () => {
    const scene: SceneGroup = {
      id: 'sc4',
      number: '4',
      heading: 'INT. PENN STATION — DAY',
      pageEighths: 11,
      locked: true,
      counts: { have: 1, need: 1, source: 0 },
      frames: [
        { id: 'a', number: '4A', spec: 'WS · 24MM · T2.8', status: 'have' },
        { id: 'b', number: '4B', spec: 'MCU · 35MM · T2.0', status: 'need' },
      ],
    };
    const html = renderToString(
      <StoryboardView
        scenes={[scene]}
        aspectRatio={2.39}
        selectedShotId="b"
        canEdit
        onSelect={noop}
        onAddFrame={noop}
        onAddScene={noop}
        onTrash={noop}
        onMove={noop}
      />,
    );
    expect(html.split('border-accent').length - 1).toBe(1);
    expect(html).toMatch(/bg-text px-1 text-text-inverse">4B</);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/data-shot-id="b"[^>]*tabindex="0"/);
    expect(html).toContain('aspect-ratio:2.39');
    expect(html).toContain('Numbers locked');
    // The empty picture stays out of the card's name, so it reads "4B MCU · 35MM · T2.0 Need to shoot".
    expect(html).toContain('<span aria-hidden="true" class="sb-label text-text-muted">No image</span>');
    expect(html).toContain('1 3/8 pg · 1 have · 1 need');
  });
});

describe('moving a frame one place', () => {
  const records = {
    sc4: record('sc4', 'scene', 'p', 'a', { number: '4' }),
    sc5: record('sc5', 'scene', 'p', 'b', { number: '5' }),
    a: record('a', 'shot', 'sc4', 'a'),
    b: record('b', 'shot', 'sc4', 'b'),
    c: record('c', 'shot', 'sc5', 'a'),
  };
  const scenes = [boardScene(records, records.sc4), boardScene(records, records.sc5)];

  it('steps over its neighbour, and crosses into the next or previous scene at either end', () => {
    expect(moveTarget(scenes, 'a', 1)).toEqual({ sceneId: 'sc4', beforeShotId: null });
    expect(moveTarget(scenes, 'b', -1)).toEqual({ sceneId: 'sc4', beforeShotId: 'a' });
    expect(moveTarget(scenes, 'b', 1)).toEqual({ sceneId: 'sc5', beforeShotId: 'c' });
    expect(moveTarget(scenes, 'c', -1)).toEqual({ sceneId: 'sc4', beforeShotId: null });
    expect(moveTarget(scenes, 'a', -1)).toBeNull();
    expect(moveTarget(scenes, 'c', 1)).toBeNull();
  });
});
