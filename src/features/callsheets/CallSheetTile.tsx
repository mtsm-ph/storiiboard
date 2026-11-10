import { useState } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { callSheet, defaultSheetDay } from '../../core/model/callsheet';
import type { SbdRecord } from '../../core/model/record';
import { dayLabel, projectShootDays } from '../../core/model/shootDay';
import type { Change } from '../../core/ops/ops';
import { Select } from '../../ui/fields';
import { callsheetNoteChange, type CallsheetNote } from './callsheetEdits';
import { CastSection, CrewSection, DaySection, LocationsSection, NotesSection, ScenesSection } from './sections';

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
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('callSheet.noProject')}</p>;
  const projectId = project.projectId;
  const days = projectShootDays(records, projectId);
  if (days.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('callSheet.noDays')}</p>;
  const selected = days.find((d) => d.record.id === chosen) ?? defaultSheetDay(days, today());
  const sheet = selected ? callSheet(records, projectId, selected.record.id) : null;
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
      <CastSection sheet={sheet} />
      <CrewSection sheet={sheet} />
      <NotesSection
        key={dayId}
        notes={sheet.notes}
        onNote={(prop: CallsheetNote, value) => {
          void edit((now) => callsheetNoteChange(now, dayId, prop, value));
        }}
      />
    </div>
  );
}
