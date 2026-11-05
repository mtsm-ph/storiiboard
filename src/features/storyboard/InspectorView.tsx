import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Crop } from '../../core/media/crop';
import { DEPARTMENT_LABELS, DEPARTMENTS, type Department } from '../../core/model/department';
import type { JsonValue } from '../../core/model/record';
import {
  choiceLabel,
  DAY_NIGHT,
  DAY_NIGHT_LABEL,
  HEIGHT_LABEL,
  HEIGHTS,
  INT_EXT,
  INT_EXT_LABEL,
  sceneNumberProblem,
  MOVE_LABEL,
  MOVES,
  pagesText,
  parsePages,
  sceneLabel,
  SHOT_SIZE_LABEL,
  SHOT_SIZES,
  SUPPORT_LABEL,
  SUPPORTS,
  T_STOPS,
  tStopLabel,
  type SceneFields,
  type ShotFields,
} from '../../core/model/storyboard';
import { SHOT_STATUSES, type ShotStatus } from '../../core/model/shotStatus';
import { isMac } from '../../app/shell/undoShortcuts';
import { fieldKey, fieldName, MAX_FIELD_NAME } from '../../core/model/customFields';
import { Button, IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Select, TextField } from '../../ui/fields';
import { CloseGlyph } from '../../ui/glyphs';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { departmentTagClass } from '../../ui/tags';
import { CropEditor } from './CropEditor';
import type { FramePictureView } from './FrameImage';
import { headingOf } from './ScenesView';
import { labels, t } from '../../core/i18n';

// The Frame inspector (design board, Storyboard workspace): the selected frame's picture, camera and story, then its
// scene.
// Each field saves as one op when it's left or picked, never on every keystroke, so History stays readable and ⌘Z
// takes back one decision at a time. Pickers stay controlled, so changing one keeps keyboard focus on it; typed
// fields are keyed by their saved value, so an undo shows in them at once. This part only draws.

/** The selected frame's picture, with where it came from. */
export interface InspectorPicture {
  view: FramePictureView;
  /** `IMG_4012.JPG`; empty for a pasted picture. */
  sourceName: string;
  /** The original's path, kept as a pointer: relative to the project's folder when inside it. */
  sourcePath: string;
}

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
  /** Numbers of scenes in the Trash, taken too until it's emptied. */
  trashedSceneNumbers?: readonly string[];
  onShotChange: (change: FieldChange) => void;
  onSceneChange: (change: FieldChange) => void;
  onSceneNumberChange: (number: string) => void;
  /** Escape: back to the frame on the board. */
  onBack: () => void;
  picture?: InspectorPicture | null;
  /** Width over height: the project's frame. */
  frameAspect?: number;
  onChoosePicture?: () => void;
  onRemovePicture?: () => void;
  onCropChange?: (crop: Crop) => void;
  /** Opens the frame's sketch in the editor. */
  onSketch?: () => void;
  /** Strokes in the frame's sketch, for the Sketch button's name. */
  strokeCount?: number;
  /** The scene's location, set from the "/" menu; null when it has none. */
  locationName?: string | null;
  /** The frame's own fields (1.19), by name. */
  customFields?: Readonly<Record<string, string>>;
  /** Every field name the project's frames use. */
  customNames?: readonly string[];
  /** Names the frame keeps something other than text under, which a new field can't take. */
  customHidden?: readonly string[];
  /** A value to set, or null to take the field off the frame. */
  /** Settles once the edit has landed, so focus can go to what it made. */
  onCustomChange?: (name: string, value: string | null) => Promise<void>;
}

const SHORT_STATUS: Readonly<Record<ShotStatus, string>> = labels({ have: 'shotStatus.have', need: 'inspector.need', source: 'shotStatus.source' });

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

interface SectionProps {
  title: string;
  children: ReactNode;
  /** Takes pictures dropped on it, for this frame (useBoardDrops). */
  dropShotId?: string;
  /** Where Enter on a frame takes focus. */
  start?: boolean;
}

function Section({ title, children, dropShotId, start = false }: SectionProps) {
  return (
    <section
      data-drop-shot={dropShotId}
      data-inspector-start={start ? '' : undefined}
      className="flex flex-col gap-3 border-b border-border p-3"
    >
      <h3 className="sb-label">{title}</h3>
      {children}
    </section>
  );
}

/** A frame's own fields (1.19): each saves like the others; a new one takes a name, offering the project's. */
function CustomFields({
  fields,
  known,
  hidden,
  onChange,
}: {
  fields: Readonly<Record<string, string>>;
  /** Every field name the project's frames use, for the new field's suggestions. */
  known: readonly string[];
  /** Names this frame keeps something other than text under. */
  hidden: readonly string[];
  /** A value to set, or null to take the field off this frame; settles once it has landed. */
  onChange: (name: string, value: string | null) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const errorId = useId();
  const rows = useRef<HTMLDivElement>(null);
  const newField = useRef<HTMLInputElement>(null);
  // After the edit lands and the row is drawn (or gone), so the focus finds it: a desktop write takes a few frames.
  // Only if the focus is still where the person left it (`from`, or nowhere): someone who has moved on isn't pulled back.
  const focusField = (field: string | null, from: Element | null) => {
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now !== from && now !== document.body && now !== null) return;
      const input = field === null ? null : rows.current?.querySelector<HTMLInputElement>(`[data-custom-field="${CSS.escape(field)}"] input`);
      (input ?? newField.current)?.focus();
    });
  };
  const add = () => {
    const tidy = fieldName(name, known, hidden);
    if (!tidy.ok) {
      setError(tidy.problem);
      return;
    }
    setError(null);
    // Add field turns off as the name clears; the name's own field keeps the focus until the new one is there.
    if (document.activeElement !== newField.current) newField.current?.focus();
    setName('');
    // Already on this frame, in any case: go to it rather than add it twice.
    const existing = fieldKey(fields, tidy.name);
    if (existing !== null) {
      focusField(existing, newField.current);
      return;
    }
    void onChange(tidy.name, '').then(() => {
      focusField(tidy.name, newField.current);
    });
  };
  const remove = (field: string) => {
    // Focus goes to the field below, or above, or New field when it was the last.
    const names = Object.keys(fields);
    const at = names.indexOf(field);
    const next = names[at + 1] ?? names[at - 1] ?? null;
    const from = document.activeElement;
    void onChange(field, null).then(() => {
      focusField(next, from);
    });
  };
  const offered = known.filter((k) => fieldKey(fields, k) === null);
  return (
    <>
      <div ref={rows} className="flex flex-col gap-3">
        {Object.entries(fields).map(([field, value]) => (
          <div key={field} data-custom-field={field} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <CommitText
                label={field}
                value={value}
                onCommit={(text) => {
                  void onChange(field, text);
                  return null;
                }}
              />
            </div>
            <IconButton
              label={t('inspector.removeField', { field })}
              onClick={() => {
                remove(field);
              }}
            >
              <CloseGlyph />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              ref={newField}
              label={t('inspectorView.newField')}
              value={name}
              list={listId}
              maxLength={MAX_FIELD_NAME}
              placeholder={t('inspectorView.droneVfxBudget')}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add();
              }}
            />
          </div>
          <Button disabled={name.trim() === ''} onClick={add}>
            {t('inspectorView.addField')}
          </Button>
        </div>
        <datalist id={listId}>
          {offered.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        {error && (
          <p id={errorId} role="alert" className="text-[12px] text-warning dark:text-text">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

/** A choice's word with a capital, as menus start them. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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
  trashedSceneNumbers = [],
  onShotChange,
  onSceneChange,
  onSceneNumberChange,
  onBack,
  picture = null,
  frameAspect = 16 / 9,
  onChoosePicture,
  onRemovePicture,
  onCropChange,
  locationName = null,
  onSketch,
  strokeCount = 0,
  customFields = {},
  customNames = [],
  customHidden = [],
  onCustomChange,
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
    return <p className="p-3 text-[13px] text-text-muted">{t('inspectorView.selectAFrameOrA')}</p>;
  }
  const s = scene.fields;
  return (
    <div ref={root} data-inspector="" className="flex flex-col">
      <header className="flex flex-col gap-0.5 border-b border-border p-3">
        <p className="font-mono text-[20px] font-bold">{shot ? shot.fields.number : sceneLabel(s.number)}</p>
        <p className="sb-label text-text-muted">
          {shot ? t('inspector.sceneLine', { scene: sceneLabel(s.number), heading: headingOf(s) }) : headingOf(s)}
        </p>
      </header>

      {shot && (
        <>
          <Section title={t('inspectorView.picture')} dropShotId={shot.id}>
            {picture ? (
              <>
                <CropEditor
                  // One editor per frame, so a move half made on one never lands on the next.
                  key={shot.id}
                  picture={picture.view}
                  frameAspect={frameAspect}
                  onCommit={(crop) => {
                    onCropChange?.(crop);
                  }}
                />
                {(picture.sourceName || picture.sourcePath) && (
                  <p className="flex min-w-0 flex-col font-mono text-[11px] text-text-muted">
                    {picture.sourceName && <span className="truncate">{picture.sourceName}</span>}
                    {/* Only a pointer to the original: the board keeps its own copy. */}
                    {picture.sourcePath && (
                      <span className="truncate" title={picture.sourcePath}>
                        {picture.sourcePath}
                      </span>
                    )}
                  </p>
                )}
              </>
            ) : (
              <div
                className="flex w-full items-center justify-center border border-dashed border-text"
                style={{ aspectRatio: String(frameAspect) }}
              >
                <span className="sb-label text-text-muted">{t('inspectorView.noPicture')}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button data-choose-picture="" onClick={onChoosePicture}>
                {picture ? t('inspector.replace') : t('inspector.choosePicture')}
              </Button>
              <Button onClick={onSketch}>{strokeCount > 0 ? t('inspector.editSketch') : t('inspector.sketch')}</Button>
              {picture && (
                <Button
                  onClick={(event) => {
                    // The button goes with the picture; focus stays in the section, on Choose picture….
                    const section = event.currentTarget.closest('section');
                    onRemovePicture?.();
                    requestAnimationFrame(() => {
                      section?.querySelector<HTMLElement>('[data-choose-picture]')?.focus();
                    });
                  }}
                >
                  {t('inspectorView.remove')}
                </Button>
              )}
            </div>
            {!picture && (
              <p className="text-[12px] text-text-muted">{t('inspector.dropOrPaste', { keys: isMac() ? '⌘V' : 'Ctrl+V' })}</p>
            )}
          </Section>

          <Section title={t('inspectorView.camera')} start>
            <SegmentedControl
              label={t('inspectorView.size')}
              options={SHOT_SIZES.map((value) => ({ value, label: SHOT_SIZE_LABEL[value] }))}
              value={shot.fields.size ?? ''}
              onChange={(size) => {
                onShotChange({ set: { size } });
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <CommitText
                label={t('inspectorView.lensMm')}
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
                  if (!Number.isFinite(mm) || mm <= 0 || mm > 2000) return t('inspector.lensProblem');
                  onShotChange({ set: { lens_mm: mm } });
                  return null;
                }}
              />
              <Select
                label={t('inspectorView.tStop')}
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
                  ['field.support', 'support', SUPPORTS, shot.fields.support, SUPPORT_LABEL],
                  ['field.height', 'height', HEIGHTS, shot.fields.height, HEIGHT_LABEL],
                  ['field.move', 'move', MOVES, shot.fields.move, MOVE_LABEL],
                ] as const
              ).map(([label, prop, options, value, words]) => (
                <Select
                  key={prop}
                  label={t(label)}
                  value={value}
                  onChange={(event) => {
                    onShotChange(pick(prop, event.currentTarget.value));
                  }}
                >
                  {/* A value typed elsewhere (an import, an older file) stays visible and selected. */}
                  {choices(value === '' || (options as readonly string[]).includes(value) ? options : [...options, value], (v) => capital(choiceLabel(words, v)))}
                </Select>
              ))}
            </div>
          </Section>

          <Section title={t('inspectorView.status')}>
            <SegmentedControl
              label={t('inspectorView.picture')}
              // Short, as the board's counts write them; the card's status shape keeps the full name for readers.
              options={SHOT_STATUSES.map((value) => ({ value, label: SHORT_STATUS[value] }))}
              value={shot.fields.status}
              onChange={(status) => {
                onShotChange({ set: { status } });
              }}
            />
          </Section>

          <Section title={t('inspectorView.story')}>
            <CommitArea
              label={t('inspectorView.action')}
              value={shot.fields.action}
              onCommit={(action) => {
                onShotChange({ set: { action } });
              }}
            />
            <CommitArea
              label={t('inspectorView.dialogue')}
              value={shot.fields.dialogue}
              onCommit={(dialogue) => {
                onShotChange({ set: { dialogue } });
              }}
            />
          </Section>

          <Section title={t('inspectorView.departments')}>
            <ul aria-label={t('inspectorView.departmentsThisFrameNeeds')} className="flex flex-wrap gap-1.5">
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

          {onCustomChange && (
            <Section title={t('inspectorView.customFields')}>
              <CustomFields key={shot.id} fields={customFields} known={customNames} hidden={customHidden} onChange={onCustomChange} />
            </Section>
          )}
        </>
      )}

      <Section title={t('inspector.sceneSection', { scene: sceneLabel(s.number) })}>
        <div className="grid grid-cols-[96px_1fr] gap-3">
          <CommitText
            label={t('inspectorView.number')}
            mono
            value={s.number}
            onCommit={(text) => {
              const number = text.trim().toUpperCase();
              const problem = sceneNumberProblem(number, otherSceneNumbers, trashedSceneNumbers);
              if (problem) return problem;
              onSceneNumberChange(number);
              return null;
            }}
          />
          <CommitText
            label={t('inspectorView.name')}
            value={s.name}
            placeholder={t('inspectorView.pennStation')}
            onCommit={(name) => {
              onSceneChange({ set: { name: name.trim() } });
              return null;
            }}
          />
        </div>
        <SegmentedControl
          label={t('inspectorView.intExt')}
          options={INT_EXT.map((value) => ({ value, label: INT_EXT_LABEL[value] }))}
          value={s.intExt ?? ''}
          onChange={(intExt) => {
            onSceneChange({ set: { int_ext: intExt } });
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('inspectorView.time')}
            value={s.dayNight ?? ''}
            onChange={(event) => {
              onSceneChange(pick('day_night', event.currentTarget.value));
            }}
          >
            {choices(DAY_NIGHT, (v) => choiceLabel(DAY_NIGHT_LABEL, v))}
          </Select>
          <CommitText
            label={t('inspectorView.length')}
            mono
            value={s.pageEighths === null ? '' : pagesText(s.pageEighths)}
            placeholder="1 3/8"
            onCommit={(text) => {
              if (text.trim() === '') {
                onSceneChange({ unset: ['page_eighths'] });
                return null;
              }
              const eighths = parsePages(text);
              if (eighths === null) return t('inspector.pagesProblem');
              onSceneChange({ set: { page_eighths: eighths } });
              return null;
            }}
          />
        </div>
      </Section>

      <Section title={t('inspectorView.links')}>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          <li className="flex justify-between gap-3">
            <span>{t('inspectorView.location')}</span>
            {/* Linked from the board's "/" menu; addresses, contacts and parking arrive in Phase 3. */}
            {locationName ? (
              <span className="truncate font-semibold">{locationName}</span>
            ) : (
              <span className="sb-label text-text-muted">{t('inspectorView.onTheBoard')}</span>
            )}
          </li>
          {[
            [t('inspector.shootDay'), t('phase.number', { phase: 3 })],
            [t('inspector.birdsEye'), t('phase.number', { phase: 5 })],
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
