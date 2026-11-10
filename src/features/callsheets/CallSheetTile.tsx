import { useDirectionsApp } from '../../app/directionsApp';
import { setPaperChoice, usePaper, usePaperChoice } from '../../app/paper';
import { isPaperChoice } from '../../core/storage/settings';
import { projectStore, useProject } from '../../app/projectStore';
import { useZonesAt } from '../../app/timeZone';
import { useWeatherUnits } from '../../app/weatherUnits';
import { t } from '../../core/i18n';
import { callSheetChecks } from '../../core/checks';
import { callSheet, defaultSheetDay } from '../../core/model/callsheet';
import { mapPlace, projectLocations } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { dayLabel, hmuMinutes, projectShootDays } from '../../core/model/shootDay';
import type { Change } from '../../core/ops/ops';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { dayPeopleAdd, dayPeopleAddEveryone, dayPeopleChoose, dayPeopleRemove } from '../schedule/dayEdits';
import { exportCallSheetPdf, type ExportCallSheetOptions } from './exportCallSheet';
import { IssuedVersions, IssueButton } from './IssueBar';
import { CallSheetChecks } from './CallSheetChecks';
import { callsheetNoteChange, departmentCallChange, hmuMinutesChange, personTimeChange, type CallsheetNote } from './callsheetEdits';
import { showSheetDay, useSheetDay } from './sheetDay';
import { useHeldForecasts } from './useHeldForecasts';
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
  const paper = usePaper();
  const paperChoice = usePaperChoice();
  const app = useDirectionsApp();
  const units = useWeatherUnits();
  // Each location's zone from its place on the map (4.3), asked of Rust once per place; before it answers, the
  // sheet shows no sun and no "Times in" line (a guess could be the wrong solar day).
  const points = (project ? projectLocations(records, project.projectId) : []).flatMap(({ record }) => {
    const place = mapPlace(record.props);
    return place ? [{ id: record.id, latitude: place.latitude, longitude: place.longitude }] : [];
  });
  const zones = useZonesAt(points);
  // The forecasts already held, for the rain check; it never asks for one (4.8).
  const held = useHeldForecasts(points);
  const chosen = useSheetDay((s) => s.dayId);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('callSheet.noProject')}</p>;
  const projectId = project.projectId;
  const days = projectShootDays(records, projectId);
  if (days.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('callSheet.noDays')}</p>;
  const selected = days.find((d) => d.record.id === chosen) ?? defaultSheetDay(days, today());
  const sheet = selected ? callSheet(records, projectId, selected.record.id, undefined, zones) : null;
  if (!selected || !sheet) return <p className="p-3 text-[13px] text-text-muted">{t('callSheet.noDays')}</p>;
  const dayId = selected.record.id;
  // Shared with the Shoot days tile's count: each tile reads its own forecasts and zones, compared by what they hold, so the same records give the one cached answer.
  const { findings } = callSheetChecks(records, projectId, dayId, held, zones);
  const canAddPeople = sheet.peopleChosen ? sheet.notOnDay.length > 0 : !sheet.peopleOdd;
  const options: ExportCallSheetOptions = { projectId, dayId, zones, projectName: project.name, paper, app, units };
  const edit = (build: (now: Records) => Change[]) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-call-sheet="">
      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-0 flex-1">
          <Select
            label={t('callSheet.pick')}
            data-day-select=""
            value={dayId}
            onChange={(event) => {
              showSheetDay(event.currentTarget.value);
            }}
          >
            {days.map((day) => (
              <option key={day.record.id} value={day.record.id}>
                {dayLabel(day)}
              </option>
            ))}
          </Select>
        </span>
        <span className="w-44">
          <Select
            label={t('callSheet.paper')}
            value={paperChoice}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (isPaperChoice(next)) setPaperChoice(next);
            }}
          >
            {/* First, so the choice can go back to following the computer; it says what that is now. */}
            <option value="region">{t('callSheet.paper.region', { paper: t(paper === 'letter' ? 'callSheet.paper.letter' : 'callSheet.paper.a4') })}</option>
            <option value="letter">{t('callSheet.paper.letter')}</option>
            <option value="a4">{t('callSheet.paper.a4')}</option>
          </Select>
        </span>
        <Button
          onClick={() => {
            void exportCallSheetPdf(options);
          }}
        >
          {t('callSheet.exportPdf')}
        </Button>
        <IssueButton sheet={sheet} options={options} />
      </div>
      <CallSheetChecks findings={findings} records={records} canAddPeople={canAddPeople} />
      <IssuedVersions sheet={sheet} dayId={dayId} />
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
        hmuMinutes={hmuMinutes(records[projectId]?.props)}
        onHmuMinutes={(minutes) => {
          void edit((now) => hmuMinutesChange(now, projectId, minutes));
        }}
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
