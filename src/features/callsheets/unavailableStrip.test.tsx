import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callSheetChecks, type CallSheetFinding } from '../../core/checks';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import { CallSheetChecks } from './CallSheetChecks';
import { findingTarget, findingWords } from './checkWords';

// The seventh check on the call sheet's strip (7.3): the person, what they do, the day and the stretch, in English and
// Spanish, with the warning sign and a Show that goes to them in "Who's on the day".

type Records = Record<string, SbdRecord>;

const at = '2026-11-21T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const away = (id: string, personId: string, from: string, to: string) => record(id, 'availability', personId, { from, to, state: 'unavailable', note: 'Family wedding' });

const project = (...more: SbdRecord[]): Records =>
  recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('d', 'shoot_day', 'p', { date: '2026-11-26', call_time: '07:00', people_ids: ['robin', 'sam'] }),
    record('robin', 'person', 'p', { name: 'Robin Vale', role: 'gaffer', departments: ['grip-electric'] }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', departments: ['sound'] }),
    away('a', 'robin', '2026-11-24', '2026-11-28'),
    ...more,
  );
const unavailable = (records: Records): CallSheetFinding[] => callSheetChecks(records, 'p', 'd').findings.filter((f) => f.kind === 'unavailable-on-day');

beforeEach(() => {
  // The tests run in Node, which has no CSS.escape; the ids here need no escaping.
  vi.stubGlobal('CSS', { escape: (value: string) => value });
});

afterEach(() => {
  setLocale('en');
  vi.unstubAllGlobals();
});

describe('the call sheet strip’s unavailable dates', () => {
  it('names the person, their role or department, the day and the stretch', () => {
    const records = project(away('s', 'sam', '2026-11-26', '2026-11-26'));
    const [robin, sam] = unavailable(records);
    if (!robin || !sam) throw new Error('two findings');
    expect(findingWords(robin, records, 'metric')).toBe('Robin Vale (Gaffer) is called on Thu, Nov 26 but marked unavailable Nov 24 – Nov 28');
    // No role: their first department; neither: the name alone.
    expect(findingWords(sam, records, 'metric')).toBe('Sam Ortiz (Sound) is called on Thu, Nov 26 but marked unavailable Nov 26');
    const bare = { ...records, sam: { ...(records.sam as SbdRecord), props: { name: 'Sam Ortiz' } } };
    expect(findingWords(sam, bare, 'metric')).toBe('Sam Ortiz is called on Thu, Nov 26 but marked unavailable Nov 26');
  });

  it('lists both stretches when two take in the day', () => {
    const records = project(away('b', 'robin', '2026-11-26', '2026-12-02'));
    const [robin] = unavailable(records);
    if (!robin) throw new Error('a finding');
    expect(unavailable(records)).toHaveLength(1);
    expect(findingWords(robin, records, 'metric')).toBe('Robin Vale (Gaffer) is called on Thu, Nov 26 but marked unavailable Nov 24 – Nov 28 and Nov 26 – Dec 2');
  });

  it('says it in Spanish', () => {
    setLocale('es');
    const records = project();
    const [robin] = unavailable(records);
    if (!robin) throw new Error('a finding');
    expect(findingWords(robin, records, 'metric')).toMatch(/^Se llama a Robin Vale \(Gaffer\) el jue, 26 nov\.?, pero marcó que no está disponible 24 nov\.? – 28 nov\.?$/);
  });

  it('draws it with the warning sign, and a Show that goes to them in “Who’s on the day”', () => {
    const records = project();
    const findings = callSheetChecks(records, 'p', 'd').findings;
    const html = renderToString(<CallSheetChecks findings={findings} records={records} canAddPeople />);
    expect(html).toContain('data-check="unavailable-on-day"');
    expect(html).toContain('Robin Vale (Gaffer) is called on Thu, Nov 26 but marked unavailable Nov 24 – Nov 28');
    expect(html).toContain('▲ ');
    const [robin] = unavailable(records);
    if (!robin) throw new Error('a finding');
    expect(findingTarget(robin, true)).toBe('[data-take-off="robin"], [data-choose-people]');
  });
});
