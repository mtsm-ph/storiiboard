import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { callSheet } from '../../core/model/callsheet';
import type { Props, SbdRecord } from '../../core/model/record';
import { CallSheetTile } from './CallSheetTile';
import { CastSection, CrewSection, DaySection, LocationsSection, NotesSection, PeopleSection, ScenesSection } from './sections';

// The tile with no project, and its sections drawn from a day's sheet. (A tile with a project open reads the store the
// app opens a file into, which renderToString can't read (it renders the store's first state); the end-to-end test
// covers a project with and without days.)

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const done = () => Promise.resolve(true);
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

describe('the Call sheet tile', () => {
  it('says to open a project when there is none', () => {
    expect(renderToString(<CallSheetTile />)).toContain('Open a project to see its call sheets.');
  });

  it('draws a day’s sections, a missing address in the warning colour and empty fields left out', () => {
    const records = recordsOf(
      record('p', 'project', null, { title: 'Bey County' }),
      record('d', 'shoot_day', 'p', { date: '2026-11-16', call_time: '07:00' }),
      record('diner', 'location', 'p', { name: 'Diner', contact_name: 'Rae', parking: 'Lot B' }),
      record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
      record('joe', 'character', 'p', { name: 'JOE' }),
      record('s1', 'scene', 'p', { number: '1', name: 'Diner', int_ext: 'INT', day_night: 'NIGHT', location_id: 'diner', character_ids: ['mary', 'joe'], page_eighths: 8 }),
      record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
      record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'], phone: '555 0199' }),
      record('sam', 'person', 'p', { name: 'Sam Ortiz', role: 'producer', title: 'Line producer', phone: '555 0100' }),
    );
    const sheet = callSheet(records, 'p', 'd');
    if (!sheet) throw new Error('no sheet');
    const html = renderToString(
      <>
        <DaySection sheet={sheet} projectName="file" />
        <LocationsSection sheet={sheet} />
        <ScenesSection sheet={sheet} />
        <PeopleSection sheet={sheet} dayName="Day 1" onAdd={done} onRemove={done} onAddEveryone={done} onChoose={done} />
        <CastSection sheet={sheet} hmuMinutes={45} onHmuMinutes={() => undefined} onTime={() => undefined} />
        <CrewSection sheet={sheet} onDepartmentCall={() => undefined} onTime={() => undefined} />
        <NotesSection notes={sheet.notes} onNote={() => undefined} />
      </>,
    );
    expect(html).toContain('Bey County');
    expect(html).toContain('Day 1 of 1');
    expect(html).toContain('Monday, November 16, 2026');
    expect(html).toContain('>07:00<');
    // No wrap time: a dash.
    expect(html).toContain('>—<');
    expect(html).toMatch(/text-warning[^>]*>.*No address yet/);
    expect(html).toContain('Lot B');
    expect(html).not.toContain('Power');
    expect(html).toContain('SC 01');
    expect(html).toContain('INT. DINER — NIGHT');
    expect(html).toContain('1 frame<');
    expect(html).toContain('Not cast');
    expect(html).toContain('as MARY');
    expect(html).toContain('Line producer');
    // Crew's phone prints by default, cast's does not (4.2).
    expect(html).toContain('555 0100');
    expect(html).not.toContain('555 0199');
    expect(html).toContain('Who’s on the day');
    expect(html).toContain('General notes');
    expect(html).toContain('Safety notes');
  });

  it('offers a day made before 4.2 to be chosen, and says so for a list this version cannot read', () => {
    const records = (day: Props) => recordsOf(record('p', 'project', null, {}), record('d', 'shoot_day', 'p', day), record('ana', 'person', 'p', { name: 'Ana Ruiz' }));
    const draw = (day: Props) => {
      const sheet = callSheet(records(day), 'p', 'd');
      if (!sheet) throw new Error('no sheet');
      return renderToString(<PeopleSection sheet={sheet} dayName="Day 1" onAdd={done} onRemove={done} onAddEveryone={done} onChoose={done} />);
    };
    const old = draw({ date: '2026-11-16' });
    expect(old).toContain('Everyone in Cast and crew');
    expect(old).toContain('Choose who’s on the day');
    // A list this version cannot read is never written over, so Choose is not offered.
    const odd = draw({ date: '2026-11-16', people_ids: 'ana' });
    expect(odd).toContain('This version can’t read who is on this day.');
    expect(odd).not.toContain('Choose who’s on the day');
    expect(draw({ date: '2026-11-16', people_ids: [] })).toContain('Nobody on this day yet.');
  });
});
