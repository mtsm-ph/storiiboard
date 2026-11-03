import { describe, expect, it } from 'vitest';
import { isSceneNumber, pageLabel, parsePages, projectStoryboard, sceneFields, sceneLabel, shotFields, specLine, tStopLabel } from './storyboard';

describe('storyboard props', () => {
  it('read page counts as a breakdown sheet writes them', () => {
    expect(pageLabel(6)).toBe('6/8 pg');
    expect(pageLabel(8)).toBe('1 pg');
    expect(pageLabel(11)).toBe('1 3/8 pg');
    expect(pageLabel(null)).toBe('—');
  });

  it('write a frame’s spec line in the board’s mono shorthand, leaving out what isn’t set', () => {
    expect(specLine(shotFields({ size: 'MCU', lens_mm: 35, t_stop: 2 }))).toBe('MCU · 35MM · T2.0');
    expect(specLine(shotFields({ size: 'INSERT', lens_mm: 50 }))).toBe('INS · 50MM');
    expect(specLine(shotFields({}))).toBe('');
    expect(tStopLabel(2.8)).toBe('T2.8');
    expect(tStopLabel(11)).toBe('T11');
  });

  it('read odd or missing values as empty, and a new frame as one still to shoot', () => {
    const shot = shotFields({ size: 'HUGE', lens_mm: 'fifty', status: 'maybe', departments: ['camera', 7] });
    expect(shot).toMatchObject({ size: null, lensMm: null, status: 'need', departments: ['camera'] });
    expect(sceneFields({ number: '4', heading: 'INT. CABIN - NIGHT' }).name).toBe('INT. CABIN - NIGHT');
    expect(sceneFields({ number: '4', numbers_locked: 'yes' }).numbersLocked).toBe(false);
  });

  it('default a project to 16:9, skipping I and O', () => {
    expect(projectStoryboard({})).toEqual({ aspectRatio: '16:9', skipIO: true });
    expect(projectStoryboard({ aspect_ratio: '2.39:1', shot_letters_allow_io: true })).toEqual({
      aspectRatio: '2.39:1',
      skipIO: false,
    });
    expect(projectStoryboard({ aspect_ratio: '3:2' }).aspectRatio).toBe('16:9');
  });

  it('label scenes as the slate does', () => {
    expect(sceneLabel('4')).toBe('SC 04');
    expect(sceneLabel('4A')).toBe('SC 4A');
  });

  it('read page lengths as people type them, and refuse what isn’t one', () => {
    expect(parsePages('1 3/8')).toBe(11);
    expect(parsePages('6/8')).toBe(6);
    expect(parsePages('2')).toBe(16);
    expect(parsePages('1 3/8 pg')).toBe(11);
    expect(parsePages('9/8')).toBeNull();
    expect(parsePages('a page')).toBeNull();
    for (const eighths of [3, 8, 11, 24]) expect(parsePages(pageLabel(eighths).replace(/ pg$/, ''))).toBe(eighths);
  });

  it('take scene numbers as scripts write them', () => {
    for (const ok of ['4', '12', '4A', 'A1', '12BC']) expect(isSceneNumber(ok)).toBe(true);
    for (const bad of ['', 'A', '4-A', 'SC 4', '4a']) expect(isSceneNumber(bad)).toBe(false);
  });
});
