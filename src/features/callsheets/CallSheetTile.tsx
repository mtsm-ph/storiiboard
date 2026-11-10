import { useState } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { useZonesAt } from '../../app/timeZone';
import { t } from '../../core/i18n';
import { callSheet, defaultSheetDay } from '../../core/model/callsheet';
import { mapPlace, projectLocations } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { dayLabel, projectShootDays } from '../../core/model/shootDay';
import type { Change } from '../../core/ops/ops';
import { Select } from '../../ui/fields';
import { dayPeopleAdd, dayPeopleAddEveryone, dayPeopleChoose, dayPeopleRemove } from '../schedule/dayEdits';
import { callsheetNoteChange, departmentCallChange, personTimeChange, type CallsheetNote } from './callsheetEdits';
import { CastSection, CrewSection, DaySection, LocationsSection, NotesSection, PeopleSection, ScenesSection } from './sections';

// The Call sheet tile (4.1), in the Production workspace: a shoot day's call sheet, built live from the project (the
// day, its locations, scenes, cast, crew), so what shows is what the crew would get. It scrolls inside the tile. The
// day picked is the tile's own state, not stored. Later milestones add their sections to callSheet() and here.

type Records = Readonly<Record<string, SbdRecord>>;

/** Today on this computer as YYYY-MM-DD: the day the tile starts on. */
function today(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function CallSheetTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [chosen, setChosen] = useState<string | null>(null);
  // Each location's zone from its place on the map (4.3), asked of Rust once per place; before it answers, the
  // sheet shows no sun and no "Times in" line (a guess could be the wrong solar day).
  const points = (project ? projectLocations(records, project.projectId) : []).flatMap(({ record }) => {
    const place = mapPlace(record.props);
    return place ? [{ id: record.id, latitude: place.latitude, longitude: place.longitude }] : [];
  });
  const zones = useZonesAt(points);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('callSheet.noProject')}</p>;
  const projectId = project.projectId;
  const days = projectShootDays(records, projectId);
  if (days.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('callSheet.noDays')}</p>;
  const selected = days.find((d) => d.record.id === chosen) ?? defaultSheetDay(days, today());
  const sheet = selected ? callSheet(records, projectId, selected.record.id, undefined, zones) : null;
  if (!selected || !sheet) return <p className="p-3 text-[13px] text-text-muted">{t('callSheet.noDays')}</p>;
  const dayId = selected.record.id;
  const edit = (build: (now: Records) => Change[]) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-call-sheet="">
      <Select
        label={t('callSheet.pick')}
        value={dayId}
        onChange={(event) => {
          setChosen(event.currentTarget.value);
        }}
      >
        {days.map((day) => (
          <option key={day.record.id} value={day.record.id}>
            {dayLabel(day)}
          </option>
        ))}
      </Select>
      <DaySection sheet={sheet} projectName={project.name} />
      <LocationsSection sheet={sheet} />
      <ScenesSection sheet={sheet} />
      <PeopleSection
        key={`people:${dayId}`}
        sheet={sheet}
        dayName={dayLabel(selected)}
        onAdd={(personId) => edit((now) => dayPeopleAdd(now, dayId, personId))}
        onRemove={(personId) => edit((now) => dayPeopleRemove(now, dayId, personId))}
        onAddEveryone={() => edit((now) => dayPeopleAddEveryone(now, projectId, dayId))}
        onChoose={() => edit((now) => dayPeopleChoose(now, projectId, dayId))}
      />
      <CastSection
        sheet={sheet}
        onTime={(personId, field, value) => {
          void edit((now) => personTimeChange(now, dayId, personId, field, value));
        }}
      />
      <CrewSection
        sheet={sheet}
        onDepartmentCall={(department, value) => {
          void edit((now) => departmentCallChange(now, dayId, department, value));
        }}
        onTime={(personId, field, value) => {
          void edit((now) => personTimeChange(now, dayId, personId, field, value));
        }}
      />
      <NotesSection
        key={`notes:${dayId}`}
        notes={sheet.notes}
        onNote={(prop: CallsheetNote, value) => {
          void edit((now) => callsheetNoteChange(now, dayId, prop, value));
        }}
      />
    </div>
  );
}
