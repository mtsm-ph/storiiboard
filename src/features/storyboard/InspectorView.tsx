import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DEPARTMENT_LABELS, DEPARTMENTS, type Department } from '../../core/model/department';
import type { JsonValue } from '../../core/model/record';
import {
  DAY_NIGHT,
  HEIGHTS,
  INT_EXT,
  isSceneNumber,
  MOVES,
  pageLabel,
  parsePages,
  sceneLabel,
  SHOT_SIZE_LABEL,
  SHOT_SIZES,
  SUPPORTS,
  T_STOPS,
  tStopLabel,
  type SceneFields,
  type ShotFields,
} from '../../core/model/storyboard';
import { SHOT_STATUSES, type ShotStatus } from '../../core/model/shotStatus';
import { cx } from '../../ui/cx';
import { Select, TextField } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { departmentTagClass } from '../../ui/tags';
import { headingOf } from './ScenesView';

// The Frame inspector (design board, Storyboard workspace): the selected frame's camera and story, then its scene.
// Each field saves as one op when it's left or picked, never on every keystroke, so History stays readable and ⌘Z
// takes back one decision at a time. Pickers stay controlled, so changing one keeps keyboard focus on it; typed
// fields are keyed by their saved value, so an undo shows in them at once. This part only draws.

/** A set and an unset, as one update op takes them. */
export interface FieldChange {
  set?: Record<string, JsonValue>;
  unset?: string[];
}

export interface InspectorViewProps {
  scene: { id: string; fields: SceneFields } | null;
  shot: { id: string; fields: ShotFields } | null;
  /** Other scenes' numbers, so a duplicate is refused. */
  otherSceneNumbers: readonly string[];
  onShotChange: (change: FieldChange) => void;
  onSceneChange: (change: FieldChange) => void;
  onSceneNumberChange: (number: string) => void;
  /** Escape: back to the frame on the board. */
  onBack: () => void;
}

const SHORT_STATUS: Readonly<Record<ShotStatus, string>> = { have: 'Have', need: 'Need', source: 'Source' };

/** A picked value, or the prop removed when the empty choice is picked. */
function pick(prop: string, value: string, asNumber = false): FieldChange {
  if (value === '') return { unset: [prop] };
  return { set: { [prop]: asNumber ? Number(value) : value } };
}

/** Escape in a typed field first puts back the saved text, so leaving doesn't save what was half-typed. */
function revertOnEscape(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, saved: string) {
  if (event.key === 'Escape') event.currentTarget.value = saved;
}

interface CommitTextProps {
  label: string;
  value: string;
  mono?: boolean;
  placeholder?: string;
  /** Returns an error to show, or null when the text was taken. */
  onCommit: (text: string) => string | null;
}

/** A text field that saves when left or on Enter; a refused entry snaps back, with the reason under it. */
function CommitText({ label, value, mono = false, placeholder, onCommit }: CommitTextProps) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="flex flex-col gap-1">
      <TextField
        key={value}
        label={label}
        mono={mono}
        defaultValue={value}
        placeholder={placeholder}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onBlur={(event) => {
          const text = event.currentTarget.value;
          if (text === value) {
            setError(null);
            return;
          }
          const problem = onCommit(text);
          setError(problem);
          if (problem !== null) event.currentTarget.value = value;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else revertOnEscape(event, value);
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-[12px] text-warning dark:text-text">
          {error}
        </p>
      )}
    </div>
  );
}

function CommitArea({ label, value, onCommit }: { label: string; value: string; onCommit: (text: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="sb-label">
        {label}
      </label>
      <textarea
        key={value}
        id={id}
        rows={3}
        defaultValue={value}
        onBlur={(event) => {
          if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          revertOnEscape(event, value);
        }}
        className="w-full border border-text bg-surface-raised px-2.5 py-2 text-[13px] text-text"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border p-3">
      <h3 className="sb-label">{title}</h3>
      {children}
    </section>
  );
}

const choices = (options: readonly string[], format: (v: string) => string = (v) => v.charAt(0).toUpperCase() + v.slice(1)) =>
  [
    <option key="" value="">
      —
    </option>,
    ...options.map((o) => (
      <option key={o} value={o}>
        {format(o)}
      </option>
    )),
  ];

export function InspectorView({
  scene,
  shot,
  otherSceneNumbers,
  onShotChange,
  onSceneChange,
  onSceneNumberChange,
  onBack,
}: InspectorViewProps) {
  // Escape anywhere in the inspector goes back to the board. One listener on the whole panel, because the segmented
  // controls handle their own keys.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onBack();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
    };
  }, [onBack, scene]);

  if (!scene) {
    return <p className="p-3 text-[13px] text-text-muted">Select a frame or a scene to see its details here.</p>;
  }
  const s = scene.fields;
  return (
    <div ref={root} data-inspector="" className="flex flex-col">
      <header className="flex flex-col gap-0.5 border-b border-border p-3">
        <p className="font-mono text-[20px] font-bold">{shot ? shot.fields.number : sceneLabel(s.number)}</p>
        <p className="sb-label text-text-muted">
          {shot ? `${sceneLabel(s.number)} · ${headingOf(s)}` : headingOf(s)}
        </p>
      </header>

      {shot && (
        <>
          <Section title="Camera">
            <SegmentedControl
              label="Size"
              options={SHOT_SIZES.map((value) => ({ value, label: SHOT_SIZE_LABEL[value] }))}
              value={shot.fields.size ?? ''}
              onChange={(size) => {
                onShotChange({ set: { size } });
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <CommitText
                label="Lens (mm)"
                mono
                value={shot.fields.lensMm === null ? '' : String(shot.fields.lensMm)}
                placeholder="35"
                onCommit={(text) => {
                  const trimmed = text.trim();
                  if (trimmed === '') {
                    onShotChange({ unset: ['lens_mm'] });
                    return null;
                  }
                  const mm = Number(trimmed.replace(/mm$/i, ''));
                  if (!Number.isFinite(mm) || mm <= 0 || mm > 2000) return 'A focal length in mm, such as 35.';
                  onShotChange({ set: { lens_mm: mm } });
                  return null;
                }}
              />
              <Select
                label="T-stop"
                mono
                value={shot.fields.tStop === null ? '' : String(shot.fields.tStop)}
                onChange={(event) => {
                  onShotChange(pick('t_stop', event.currentTarget.value, true));
                }}
              >
                {choices(T_STOPS.map(String), (v) => tStopLabel(Number(v)))}
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ['Support', 'support', SUPPORTS, shot.fields.support],
                  ['Height', 'height', HEIGHTS, shot.fields.height],
                  ['Move', 'move', MOVES, shot.fields.move],
                ] as const
              ).map(([label, prop, options, value]) => (
                <Select
                  key={prop}
                  label={label}
                  value={value}
                  onChange={(event) => {
                    onShotChange(pick(prop, event.currentTarget.value));
                  }}
                >
                  {/* A value typed elsewhere (an import, an older file) stays visible and selected. */}
                  {choices(value === '' || (options as readonly string[]).includes(value) ? options : [...options, value])}
                </Select>
              ))}
            </div>
          </Section>

          <Section title="Status">
            <SegmentedControl
              label="Picture"
              // Short, as the board's counts write them; the card's status shape keeps the full name for readers.
              options={SHOT_STATUSES.map((value) => ({ value, label: SHORT_STATUS[value] }))}
              value={shot.fields.status}
              onChange={(status) => {
                onShotChange({ set: { status } });
              }}
            />
          </Section>

          <Section title="Story">
            <CommitArea
              label="Action"
              value={shot.fields.action}
              onCommit={(action) => {
                onShotChange({ set: { action } });
              }}
            />
            <CommitArea
              label="Dialogue"
              value={shot.fields.dialogue}
              onCommit={(dialogue) => {
                onShotChange({ set: { dialogue } });
              }}
            />
          </Section>

          <Section title="Departments">
            <ul aria-label="Departments this frame needs" className="flex flex-wrap gap-1.5">
              {DEPARTMENTS.map((department: Department) => {
                const on = shot.fields.departments.includes(department);
                return (
                  <li key={department}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on
                          ? shot.fields.departments.filter((d) => d !== department)
                          : [...shot.fields.departments, department];
                        onShotChange({ set: { departments: next } });
                      }}
                      // On, a tag in its department colour; off, an outline. Pressed state is announced, not shown
                      // by colour alone: the fill itself is the second cue.
                      className={cx('sb-label', on ? departmentTagClass(department) : 'border border-dashed border-text px-[5.5px] py-[2.5px]')}
                    >
                      {DEPARTMENT_LABELS[department]}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}

      <Section title={`Scene ${sceneLabel(s.number)}`}>
        <div className="grid grid-cols-[96px_1fr] gap-3">
          <CommitText
            label="Number"
            mono
            value={s.number}
            onCommit={(text) => {
              const number = text.trim().toUpperCase();
              if (!isSceneNumber(number)) return 'Scene numbers look like 4, 4A or A1.';
              if (otherSceneNumbers.includes(number)) return `There's already a scene ${number}.`;
              onSceneNumberChange(number);
              return null;
            }}
          />
          <CommitText
            label="Name"
            value={s.name}
            placeholder="Penn Station"
            onCommit={(name) => {
              onSceneChange({ set: { name: name.trim() } });
              return null;
            }}
          />
        </div>
        <SegmentedControl
          label="INT / EXT"
          options={INT_EXT.map((value) => ({ value, label: value }))}
          value={s.intExt ?? ''}
          onChange={(intExt) => {
            onSceneChange({ set: { int_ext: intExt } });
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Time"
            value={s.dayNight ?? ''}
            onChange={(event) => {
              onSceneChange(pick('day_night', event.currentTarget.value));
            }}
          >
            {choices(DAY_NIGHT, (v) => v)}
          </Select>
          <CommitText
            label="Length"
            mono
            value={s.pageEighths === null ? '' : pageLabel(s.pageEighths).replace(/ pg$/, '')}
            placeholder="1 3/8"
            onCommit={(text) => {
              if (text.trim() === '') {
                onSceneChange({ unset: ['page_eighths'] });
                return null;
              }
              const eighths = parsePages(text);
              if (eighths === null) return 'Pages and eighths, such as 1 3/8 or 6/8.';
              onSceneChange({ set: { page_eighths: eighths } });
              return null;
            }}
          />
        </div>
      </Section>

      <Section title="Links">
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {[
            ['Location', 'Phase 3'],
            ['Shoot day', 'Phase 3'],
            ["Bird's-eye setup", 'Phase 5'],
          ].map(([name, phase]) => (
            <li key={name} className="flex justify-between">
              <span>{name}</span>
              <span className="sb-label text-text-muted">{phase}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
