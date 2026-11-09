import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import {
  dayFrames,
  dayLabel,
  dayTotals,
  durationLabel,
  projectShootDays,
  SETUP_MINUTES,
  setupMinutes,
  unscheduledFrames,
  type ShootDay,
} from '../../core/model/shootDay';
import { sceneFields, sceneLabel, shotFields, specLine } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Select, TextArea, TextField } from '../../ui/fields';
import { StatusGlyph } from '../../ui/tags';
import { headingOf } from '../storyboard/ScenesView';
import { dayChange, newDay, scheduleFrames, setupMinutesChange, trashDay, type DayField } from './dayEdits';

// The Days tile (3.7), in the Production workspace: the shoot's days, each with its date, call and wrap, the frames shot
// that day and what that adds up to (frames, setups, hours at the project's minutes per setup); and the "Need to shoot"
// frames not in any day yet, to add a frame or a whole scene's at once. A frame moves between days from its own row.
// Every change is one edit, so one ⌘Z. Narrow (Production gives it a column), the list sits above the day.

type Records = Readonly<Record<string, SbdRecord>>;

/** Narrower than this, the list goes above the day rather than beside it. */
const SIDE_BY_SIDE = 560;

/** Today on this computer as YYYY-MM-DD: a new project's first day. */
function today(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Focus, once the list has drawn again, on the row that took the place of those `gone` from `ids`, else on `fallback`. */
function focusAfter(ids: readonly string[], gone: readonly string[], attribute: string, fallback: () => HTMLElement | null) {
  const left = new Set(gone);
  const at = ids.findIndex((id) => left.has(id));
  const last = ids.findLastIndex((id) => left.has(id));
  const next = ids.slice(last + 1).find((id) => !left.has(id)) ?? ids.slice(0, Math.max(at, 0)).findLast((id) => !left.has(id));
  requestAnimationFrame(() => {
    const row = next ? document.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(next)}"]`) : null;
    (row ?? fallback())?.focus();
  });
}

export function DaysTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [chosen, setChosen] = useState<string | null>(null);
  const listId = useId();
  const newButton = useRef<HTMLButtonElement>(null);
  const making = useRef(false);
  const [width, setWidth] = useState(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const measure = useCallback((element: HTMLDivElement | null) => {
    setBox(element);
    if (element) setWidth(element.getBoundingClientRect().width);
  }, []);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [box]);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('days.noProject')}</p>;
  const projectId = project.projectId;
  const days = projectShootDays(records, projectId);
  const selected = days.find((d) => d.record.id === chosen) ?? days[0] ?? null;
  const minutes = setupMinutes(records[projectId]?.props);
  const wide = width >= SIDE_BY_SIDE;

  const edit = (build: (now: Records) => Change[]) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div ref={measure} className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      <div className={cx('flex shrink-0 flex-col border-border', wide ? 'w-[240px] border-r' : 'max-h-[40%] border-b')}>
        <div className="flex items-center gap-2 border-b border-border p-2">
          <p className="sb-label flex-1 font-mono">{tn('days.count', days.length)}</p>
          <Button
            ref={newButton}
            onClick={() => {
              if (making.current) return;
              making.current = true;
              const id = crypto.randomUUID();
              // From the records at its turn, so two quick clicks never share a date or a place in the list.
              void edit((now) => [newDay(now, projectId, today(), id)])
                .then((made) => {
                  if (!made) return;
                  setChosen(id);
                  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-day-id="${CSS.escape(id)}"]`)?.focus());
                })
                .finally(() => {
                  making.current = false;
                });
            }}
          >
            {t('days.new')}
          </Button>
        </div>
        {days.length === 0 ? (
          <p className="p-3 text-[13px] text-text-muted">{t('days.none')}</p>
        ) : (
          <ul id={listId} aria-label={t('days.list')} className="min-h-0 flex-1 overflow-y-auto">
            {days.map((day) => {
              const current = day.record.id === selected?.record.id;
              const totals = dayTotals(dayFrames(records, projectId, day.record.id), minutes);
              return (
                <li key={day.record.id}>
                  <button
                    type="button"
                    aria-current={current || undefined}
                    data-day-id={day.record.id}
                    onClick={() => {
                      setChosen(day.record.id);
                    }}
                    // On the ink fill, the focus ring is paper (DESIGN.md: never ink on ink).
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left focus-visible:-outline-offset-2',
                      current ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span className="text-[13px] font-semibold">{dayLabel(day)}</span>
                    <span className="sb-label font-mono">
                      {day.fields.callTime && `${t('days.callShort', { time: day.fields.callTime })} · `}
                      {tn('days.frames', totals.frames)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border p-2">
          <SetupMinutes
            key={minutes}
            minutes={minutes}
            onChange={(value) => {
              void edit((now) => setupMinutesChange(now, projectId, value));
            }}
          />
        </div>
      </div>
      {selected ? (
        <DayEditor
          key={selected.record.id}
          day={selected}
          days={days}
          records={records}
          projectId={projectId}
          minutes={minutes}
          onField={(prop, value) => {
            void edit((now) => dayChange(now, selected.record.id, prop, value));
          }}
          onSchedule={(shotIds, dayId) => edit((now) => scheduleFrames(now, shotIds, dayId))}
          onDelete={() => {
            const label = dayLabel(selected);
            const ids = days.map((d) => d.record.id);
            void edit((now) => trashDay(now, selected.record.id)).then((done) => {
              if (!done) return;
              // A note about this step: an undo clears it.
              showInfo(t('days.trashed', { day: label }), { step: true });
              setChosen(null);
              focusAfter(ids, [selected.record.id], 'data-day-id', () => newButton.current);
            });
          }}
        />
      ) : (
        <p className="p-3 text-[13px] text-text-muted">{t('days.pickOrMake')}</p>
      )}
    </div>
  );
}

/** Minutes per setup for every day's estimate: one edit when it's left, if it changed and is in range. */
function SetupMinutes({ minutes, onChange }: { minutes: number; onChange: (value: number) => void }) {
  return (
    <TextField
      label={t('days.setupMinutes')}
      type="number"
      mono
      min={SETUP_MINUTES.min}
      max={SETUP_MINUTES.max}
      defaultValue={String(minutes)}
      onBlur={(event) => {
        const value = Number(event.currentTarget.value);
        if (Number.isInteger(value) && value >= SETUP_MINUTES.min && value <= SETUP_MINUTES.max) onChange(value);
        else event.currentTarget.value = String(minutes);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/**
 * A frame's way to another day, or out of them: pick, then Move, so arrowing through the choices never moves it. The
 * choice starts on the day it's in, so the field says where it is, and Move does nothing until another is picked.
 */
function MoveFrame({ frame, here, days, shotId, onMove }: { frame: string; here: ShootDay; days: readonly ShootDay[]; shotId: string; onMove: (to: string | null) => void }) {
  const [to, setTo] = useState(here.record.id);
  const NONE = 'none';
  return (
    <span className="flex shrink-0 items-end gap-1.5">
      <span className="w-40">
        <Select
          label={t('days.moveTo')}
          aria-label={t('days.moveToFor', { frame })}
          value={to}
          data-day-frame={shotId}
          onChange={(event) => {
            setTo(event.currentTarget.value);
          }}
        >
          {days.map((d) => (
            <option key={d.record.id} value={d.record.id}>
              {dayLabel(d)}
            </option>
          ))}
          <option value={NONE}>{t('days.notScheduled')}</option>
        </Select>
      </span>
      <Button
        aria-label={t('days.moveNamed', { frame })}
        disabled={to === here.record.id}
        onClick={() => {
          onMove(to === NONE ? null : to);
        }}
      >
        {t('days.move')}
      </Button>
    </span>
  );
}

interface DayEditorProps {
  day: ShootDay;
  days: readonly ShootDay[];
  records: Records;
  projectId: string;
  minutes: number;
  onField: (prop: DayField, value: string) => void;
  /** Frames into a day, or out of every day with null; settles once the edit has landed. */
  onSchedule: (shotIds: readonly string[], dayId: string | null) => Promise<boolean>;
  onDelete: () => void;
}

function DayEditor({ day, days, records, projectId, minutes, onField, onSchedule, onDelete }: DayEditorProps) {
  const headingId = useId();
  const framesId = useId();
  const needId = useId();
  const id = day.record.id;
  const label = dayLabel(day);
  const frames = dayFrames(records, projectId, id);
  const totals = dayTotals(frames, minutes);
  const waiting = unscheduledFrames(records, projectId);
  // The "Need to shoot" frames by scene, in board order, for Add all.
  const byScene: { scene: SbdRecord; shots: SbdRecord[] }[] = [];
  for (const { scene, shot } of waiting) {
    const last = byScene.at(-1);
    if (last?.scene.id === scene.id) last.shots.push(shot);
    else byScene.push({ scene, shots: [shot] });
  }
  const waitingIds = waiting.map(({ shot }) => shot.id);
  const frameIds = frames.map(({ shot }) => shot.id);

  const field = (prop: DayField, value: string, labelText: string, type: 'date' | 'time') => (
    <TextField
      // Keyed by the value, so an undo shows in the field it changed.
      key={`${prop}:${value}`}
      label={labelText}
      type={type}
      mono
      defaultValue={value}
      onBlur={(event) => {
        // Half typed (a date missing its year), the field reads empty: that's not clearing it, so nothing changes. A
        // day keeps a date once it has one (WebKit may not say an unfinished date is bad input, so an empty date is
        // never taken as an edit); a time can be cleared.
        if (event.currentTarget.validity.badInput || (prop === 'date' && event.currentTarget.value === '')) {
          event.currentTarget.value = value;
          return;
        }
        if (event.currentTarget.value !== value) onField(prop, event.currentTarget.value);
      }}
    />
  );

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-day-editor="">
      <h2 id={headingId} tabIndex={-1} className="text-[18px] leading-tight font-bold focus-visible:outline-offset-2">
        {label}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
        {field('date', day.fields.date, t('days.date'), 'date')}
        {field('call_time', day.fields.callTime, t('days.call'), 'time')}
        {field('wrap_time', day.fields.wrapTime, t('days.wrap'), 'time')}
      </div>
      <p data-day-totals="" className="flex flex-wrap gap-x-3 font-mono text-[12px]">
        <span>{tn('days.frames', totals.frames)}</span>
        <span>{tn('days.setups', totals.setups)}</span>
        <span>{t('days.estimate', { duration: durationLabel(totals.minutes) })}</span>
      </p>
      <TextArea
        key={`notes:${day.fields.notes}`}
        label={t('days.notes')}
        defaultValue={day.fields.notes}
        onBlur={(event) => {
          if (event.currentTarget.value !== day.fields.notes) onField('notes', event.currentTarget.value);
        }}
      />

      <section aria-labelledby={framesId} className="flex flex-col">
        <h3 id={framesId} className="sb-label border-b-[1.5px] border-text pb-1">
          {t('days.framesOnDay')}
        </h3>
        {frames.length === 0 ? (
          <p className="py-2 text-[13px] text-text-muted">{t('days.noFrames')}</p>
        ) : (
          <ul aria-label={t('days.framesOn', { day: label })}>
            {frames.map(({ scene, shot }) => {
              const f = shotFields(shot.props);
              return (
                <li key={shot.id} className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 text-[13px]">
                  <StatusGlyph status={f.status} />
                  <span className="w-12 shrink-0 font-mono">{sceneLabel(sceneFields(scene.props).number)}</span>
                  <span className="w-10 shrink-0 font-mono font-bold">{f.number}</span>
                  <span data-user-text="" className="min-w-0 flex-1 truncate">
                    {f.title || specLine(f)}
                  </span>
                  <MoveFrame
                    frame={f.number}
                    here={day}
                    days={days}
                    shotId={shot.id}
                    onMove={(to) => {
                      void onSchedule([shot.id], to).then((done) => {
                        if (done) focusAfter(frameIds, [shot.id], 'data-day-frame', () => document.getElementById(headingId));
                      });
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={needId} className="flex flex-col">
        <h3 id={needId} className="sb-label border-b-[1.5px] border-text pb-1">
          {t('days.needToShoot')}
        </h3>
        {byScene.length === 0 ? (
          <p className="py-2 text-[13px] text-text-muted">{t('days.allScheduled')}</p>
        ) : (
          byScene.map(({ scene, shots }) => {
            const s = sceneFields(scene.props);
            const sceneName = sceneLabel(s.number);
            return (
              <div key={scene.id} className="flex flex-col border-b border-border py-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-mono font-bold">{sceneName}</span>
                  <span className="min-w-0 flex-1 truncate">{headingOf(s)}</span>
                  <Button
                    data-add-scene={scene.id}
                    aria-label={tn('days.addSceneNamed', shots.length, { scene: sceneName, day: label })}
                    onClick={() => {
                      const ids = shots.map((shot) => shot.id);
                      void onSchedule(ids, id).then((done) => {
                        if (done) focusAfter(waitingIds, ids, 'data-add-frame', () => document.getElementById(headingId));
                      });
                    }}
                  >
                    {tn('days.addScene', shots.length)}
                  </Button>
                </div>
                <ul aria-label={t('days.needIn', { scene: sceneName })}>
                  {shots.map((shot) => {
                    const f = shotFields(shot.props);
                    return (
                      <li key={shot.id} className="flex items-center gap-2 py-0.5 pl-4 text-[13px]">
                        <span className="w-10 shrink-0 font-mono font-bold">{f.number}</span>
                        <span data-user-text="" className="min-w-0 flex-1 truncate">
                          {f.title || specLine(f)}
                        </span>
                        <Button
                          variant="ghost"
                          data-add-frame={shot.id}
                          aria-label={t('days.addFrameNamed', { frame: f.number, day: label })}
                          onClick={() => {
                            void onSchedule([shot.id], id).then((done) => {
                              if (done) focusAfter(waitingIds, [shot.id], 'data-add-frame', () => document.getElementById(headingId));
                            });
                          }}
                        >
                          {t('days.add')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <div className="pt-1">
        <Button variant="warning" onClick={onDelete}>
          {t('days.delete')}
        </Button>
      </div>
    </section>
  );
}
