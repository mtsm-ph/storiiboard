import { EditableTitle } from '../../ui/EditableTitle';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { Crop } from '../../core/media/crop';
import type { DepartmentStatuses } from '../../core/model/departmentStatus';
import { DEPARTMENTS, type Department } from '../../core/model/department';
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
import { fieldKey, fieldName, MAX_FIELD_NAME, type FieldsOf } from '../../core/model/customFields';
import { Button, IconButton } from '../../ui/Button';
import { BarGauge, Select, TextField } from '../../ui/fields';
import { CloseGlyph } from '../../ui/glyphs';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { CropEditor } from './CropEditor';
import { ClipPreview, type ClipPreviewProps } from '../video/ClipPreview';
import { DepartmentStatusTable } from './DepartmentStatusTable';
import { RestOfCrew } from '../department/RestOfCrew';
import type { Focus } from '../department/perspective';
import type { FramePictureView } from './FrameImage';
import { headingOf } from './ScenesView';
import { labels, localizeError, t, type MessageKey } from '../../core/i18n';

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

/** The video a frame plays (2.2b), as the inspector shows it. */
export interface InspectorVideo {
  /** The clip's file name: `A001_C003_0101AB.MP4`. */
  name: string;
  /** "23.976 fps · 3840 × 2160 · H264". */
  details: string;
  /** The clip's timecode, in to out, and its length. */
  range: string;
  frames: string;
  /** Where the project says it is: relative to the project's folder when inside it. */
  path: string;
  /** Its file can't be found, or read, on this computer. */
  missing: boolean;
  /** The video's record is gone (Empty Trash, a History restore): only Unlink is left to do. */
  gone: boolean;
  /** Its playback copy (2.3b); left out while it hasn't been looked for. */
  copy?: InspectorCopy;
  /**
   * Its LUT (2.5): the one set (null for none) and the project's LUTs to pick from. Every frame of the take shows it;
   * it grades the playback copy, never the original.
   */
  lut?: { id: string | null; choices: readonly { id: string; name: string }[]; listed?: boolean };
  /** The frame's clip, in to out, framed as the frame is, to play here (2.8); left out until there's a copy. */
  preview?: ClipPreviewProps;
}

/** A video's playback copy (2.3b): none yet, waiting its turn, being made (how far, 0 to 1, when known), made (without
 * sound when the original's couldn't be read), or failed with Rust's message. */
export type InspectorCopy =
  | { state: 'none' }
  | { state: 'queued' }
  | { state: 'making'; done: number | null }
  | { state: 'made'; silent: boolean; quiet?: boolean }
  | { state: 'failed'; message: string };

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
  /** The video the frame plays (2.2b); null for none. */
  video?: InspectorVideo | null;
  onLinkVideo?: () => void;
  onRelinkVideo?: () => void;
  onUnlinkVideo?: () => void;
  /** Puts the video's playback copy on the queue, or tries again (2.3b). */
  onMakeCopy?: () => void;
  /** Saves the frame's clip as a file (2.8b); `savingClip` while it's being made. */
  onSaveClip?: () => void;
  savingClip?: boolean;
  /** Stops the clip being saved. */
  onCancelSaveClip?: () => void;
  /** Asks for a `.cube` and sets it as the video's LUT (2.5). */
  onLoadLut?: () => void;
  /** Sets the video's LUT to one the project has, or none (null). */
  onSetLut?: (lutId: string | null) => void;
  onCancelCopy?: () => void;
  onCropChange?: (crop: Crop) => void;
  /** Opens the frame's sketch in the editor. */
  onSketch?: () => void;
  /** Strokes in the frame's sketch, for the Sketch button's name. */
  strokeCount?: number;
  /** The scene's location, set from the "/" menu; null when it has none. */
  locationName?: string | null;
  /**
   * Where this frame is shot, when it isn't its scene's location (3.3): an insert or a pickup elsewhere. `value` is its
   * own location's id, or '' for the scene's; `choices` the project's locations.
   */
  frameLocation?: { value: string; sceneName: string | null; choices: readonly { id: string; name: string }[]; onChange: (id: string | null) => void };
  /** The frame's own fields (1.19), by name. */
  customFields?: Readonly<Record<string, string>>;
  /** Every field name the project's frames use. */
  customNames?: readonly string[];
  /** Names the frame keeps something other than text under, which a new field can't take. */
  customHidden?: readonly string[];
  /** A value to set, or null to take the field off the frame. */
  /** Settles once the edit has landed, so focus can go to what it made. */
  onCustomChange?: (name: string, value: string | null) => Promise<void>;
  /** The departments that have opened this frame (polish 6b). */
  seen?: readonly string[];
  /** The scene's palette editor (polish PP), under the scene's own section. */
  palette?: ReactNode;
  /** The boards linked to the scene (5.4); left out, so nothing shows, when none is. */
  boards?: ReactNode;
  /** A department status edit (polish 6), worked out from the frame as it is when the edit lands. */
  onDepartmentStatus?: (edit: (now: DepartmentStatuses) => DepartmentStatuses | null) => void;
  /** The scene's department approvals (3.6b), in a section of their own after the scene's. */
  approvals?: ReactNode;
  /** The gear the frame needs (3.9b), after its departments. */
  gear?: ReactNode;
  /** Your departments first, the rest under Rest of crew (3.6c); null or left out for the full view. */
  focus?: Focus;
  /** Opens a department's workspace from its name in the department table (3.6a). */
  onOpenDepartment?: (department: Department) => void;
  /**
   * The frame's shoot day (5.11): "Day 2 · Tue, Nov 18" and what opens it, or null when the frame is in no live day.
   * Left out, with no frame shown, so the row isn't drawn.
   */
  shootDay?: { label: string; onOpen: () => void } | null;
  /**
   * The frame's setup (6.0): `value` is its setup's id, or '' for none; `choices` its scene's setups by number and name.
   * `onChange` takes the setup picked, No setup, or a new setup with this frame in it.
   */
  setup?: { value: string; choices: readonly { id: string; label: string }[]; onChange: (to: SetupPick) => void };
  /**
   * The frame's lens (6.1): `value` is the picked lens's id, or '' for none; `choices` the project's lenses; `range` the
   * picked lens's focal range, which the focal length typed must sit in. `fieldOfView` is the line under it.
   */
  lens?: InspectorLens;
}

/** The field of view as the Inspector reads it out (6.1), each figure to one decimal; or why there's none. */
export type InspectorFieldOfView =
  | { degrees: string; width: string; sensorWidth: string; sensorHeight: string }
  | { missing: 'noBody' | 'noLens' | 'noSensor' };

export interface InspectorLens {
  value: string;
  choices: readonly { id: string; label: string }[];
  range: { min: number; max: number } | null;
  onChange: (id: string | null) => void;
  fieldOfView: InspectorFieldOfView;
}

const FOV_MISSING = { noBody: 'inspector.fovNoBody', noLens: 'inspector.fovNeedsLens', noSensor: 'inspector.fovNeedsSensor' } as const;

const NOTHING_SEEN: readonly string[] = [];

/** What the Setup row picked (6.0). */
export type SetupPick = { kind: 'none' } | { kind: 'new' } | { kind: 'join'; id: string };

/** The Setup row's choice for a new setup: never a record's id, which is a UUID. */
const NEW_SETUP = 'new';

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

/**
 * A video's LUT (2.5): the project's LUTs to pick from, with None, and Load LUT… for a `.cube` not loaded yet. A LUT
 * the list hasn't read yet is still shown as set; one not in it once read says so.
 */
function LutPicker({
  lut,
  onLoad,
  onSet,
}: {
  lut: NonNullable<InspectorVideo['lut']>;
  onLoad: (() => void) | undefined;
  onSet: ((lutId: string | null) => void) | undefined;
}) {
  const known = lut.id === null || lut.choices.some((choice) => choice.id === lut.id);
  return (
    <div data-video-lut="" className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <Select
          label={t('inspector.lut')}
          value={lut.id ?? ''}
          onChange={(event) => {
            onSet?.(event.target.value === '' ? null : event.target.value);
          }}
        >
          <option value="">{t('inspector.lutNone')}</option>
          {/* Not in the list: still being read, or (once read) named but not stored, a file edited by hand. */}
          {!known && lut.id !== null && <option value={lut.id}>{lut.listed ? t('inspector.lutMissing') : t('inspector.lutReading')}</option>}
          {lut.choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </Select>
      </div>
      <Button data-load-lut="" onClick={onLoad}>
        {t('inspector.loadLut')}
      </Button>
    </div>
  );
}

/** The playback copy's line (2.3b). The live region is always there, so the line is heard as it changes; the
 * percentage is a meter beside it, so it isn't read out every half second. */
function CopyLine({ copy, lineRef }: { copy: InspectorCopy | undefined; lineRef?: Ref<HTMLDivElement> }) {
  return (
    // Focusable by script only: where focus goes when the copy's button goes (the copy made).
    <div ref={lineRef} tabIndex={-1} data-copy-line="" className="flex flex-col gap-1.5">
      <div role="status" data-copy-state="" className="flex">
        {copy?.state === 'none' && <p className="text-[12px] text-text-muted">{t('inspector.copyNone')}</p>}
        {copy?.state === 'queued' && <p className="text-[12px]">{t('inspector.copyQueued')}</p>}
        {copy?.state === 'making' && <p className="text-[12px]">{t('inspector.copyMaking')}</p>}
        {copy?.state === 'made' && (
          <p className="text-[12px]">{copy.quiet ? t('inspector.copyQuiet') : copy.silent ? t('inspector.copySilent') : t('inspector.copyMade')}</p>
        )}
        {copy?.state === 'failed' && (
          <p className="inline-block self-start bg-warning px-[7px] py-1 text-[12px] text-paper-fixed">{localizeError(copy.message)}</p>
        )}
      </div>
      {copy?.state === 'making' && copy.done !== null && <BarGauge label={t('inspector.copyProgress')} value={Math.round(copy.done * 100)} />}
    </div>
  );
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

/** Each kind's own words for its fields (3.3, 3.5). */
const REMOVE_FIELD = { frame: 'inspector.removeField', location: 'location.removeField', person: 'person.removeField' } as const satisfies Record<FieldsOf, MessageKey>;
const FIELD_EXAMPLES = { frame: 'inspectorView.droneVfxBudget', location: 'location.fieldExamples', person: 'person.fieldExamples' } as const satisfies Record<FieldsOf, MessageKey>;

/** A frame's own fields (1.19), a location's or a person's: each saves like the others; a new one takes a name, offering the project's. */
export function CustomFields({
  fields,
  known,
  hidden,
  onChange,
  of = 'frame',
}: {
  /** A frame's fields, a location's (3.3) or a person's (3.5): their reserved names and words. */
  of?: FieldsOf;
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
    const tidy = fieldName(name, known, hidden, of);
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
              label={t(REMOVE_FIELD[of], { field })}
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
              placeholder={t(FIELD_EXAMPLES[of])}
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
  video = null,
  onLinkVideo,
  onRelinkVideo,
  onUnlinkVideo,
  onMakeCopy,
  onCancelCopy,
  onLoadLut,
  onSetLut,
  onSaveClip,
  savingClip = false,
  onCancelSaveClip,
  onCropChange,
  locationName = null,
  frameLocation,
  onSketch,
  strokeCount = 0,
  customFields = {},
  customNames = [],
  customHidden = [],
  onCustomChange,
  approvals,
  gear,
  focus = null,
  onOpenDepartment,
  onDepartmentStatus,
  seen = NOTHING_SEEN,
  palette,
  boards,
  shootDay,
  setup,
  lens,
}: InspectorViewProps) {
  // Escape anywhere in the inspector goes back to the board. One listener on the whole panel, because the segmented
  // controls handle their own keys.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      // In a typed field, the field's own Escape (put the text back) runs first, in React's handler further up the
      // page: going back now would blur it and save what was half typed. So it goes back once that has run.
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        setTimeout(onBack, 0);
        return;
      }
      onBack();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => {
      element.removeEventListener('keydown', onKeyDown);
    };
  }, [onBack, scene]);

  // The copy's one button: Make playback copy (Try again after a failure) or, while it's waiting or being made, Cancel
  // copy. One element whatever its job, so focus stays on it as the job changes. When it goes (the copy made, the file
  // missing), focus that was on it moves to the copy's line rather than falling to the page.
  const copyState = video?.copy?.state;
  const copyAction: 'make' | 'cancel' | null =
    !video || video.gone
      ? null
      : copyState === 'queued' || copyState === 'making'
        ? 'cancel'
        : !video.missing && (copyState === 'none' || copyState === 'failed')
          ? 'make'
          : null;
  // The button while focus is on it; a blur that isn't its own going (focus moved on) lets it go.
  const copyButton = useRef<HTMLButtonElement | null>(null);
  const copyLine = useRef<HTMLDivElement>(null);
  const videoMissing = video?.missing ?? false;
  useEffect(() => {
    const button = copyButton.current;
    if (copyAction !== null || !button) return;
    copyButton.current = null;
    // Focus was on it when it went, and nothing has it since: to the copy's line, or for a video gone missing, to
    // Relink, the way back (the line is empty then).
    if (button.isConnected || (document.activeElement !== null && document.activeElement !== document.body)) return;
    const inspector = root.current;
    const target = videoMissing ? inspector?.querySelector<HTMLElement>('[data-relink-video]') : copyLine.current;
    target?.focus();
  }, [copyAction, videoMissing]);

  if (!scene) {
    return <p className="p-3 text-[13px] text-text-muted">{t('inspectorView.selectAFrameOrA')}</p>;
  }
  const s = scene.fields;
  return (
    <div ref={root} data-inspector="" className="flex flex-col">
      <header className="flex flex-col gap-0.5 border-b border-border p-3">
        <p className="font-mono text-[20px] font-bold">{shot ? shot.fields.number : sceneLabel(s.number)}</p>
        {/* The frame's title, or the scene's name, edited in place (Nov 5): the pencil always shows here. */}
        {shot ? (
          <EditableTitle
            key={shot.id}
            value={shot.fields.title}
            shown={shot.fields.title === '' ? <span className="text-text-muted">{t('title.none')}</span> : <span data-user-text="">{shot.fields.title}</span>}
            label={t('title.shotTitle', { number: shot.fields.number || t('history.aFrame') })}
            reveal
            className="text-[13px]"
            inputClassName="w-full"
            onSave={(title) => {
              onShotChange(title === '' ? { unset: ['title'] } : { set: { title } });
            }}
          />
        ) : null}
        <p className="sb-label text-text-muted">
          {shot ? (
            t('inspector.sceneLine', { scene: sceneLabel(s.number), heading: headingOf(s) })
          ) : (
            <EditableTitle
              key={scene.id}
              value={s.name}
              shown={headingOf(s)}
              label={t('title.sceneName', { scene: sceneLabel(s.number) })}
              reveal
              inputClassName="w-full normal-case tracking-normal"
              onSave={(name) => {
                onSceneChange({ set: { name } });
              }}
            />
          )}
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
                    {picture.sourceName && (
                      <span className="truncate" title={picture.sourceName}>
                        {picture.sourceName}
                      </span>
                    )}
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
              {onLinkVideo && (
                <Button data-link-video="" onClick={onLinkVideo}>
                  {t('inspector.linkVideo')}
                </Button>
              )}
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

          {video && (
            <Section title={t('inspectorView.video')}>
              <div data-video-details="" className="flex min-w-0 flex-col gap-1">
                {video.gone ? (
                  <p className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">{t('inspector.videoGone')}</p>
                ) : (
                  <p data-user-text="" className="truncate font-mono text-[12px] font-bold" title={video.name}>
                    {video.name}
                  </p>
                )}
                {/* Missing media is flagged plainly, with the way back (CLAUDE.md); words, not only colour. The live
                    region is always there, so a screen reader hears the line when it appears. */}
                <div role="status" className="flex">
                  {video.missing && !video.gone && (
                    <p className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">{t('inspector.videoMissing')}</p>
                  )}
                </div>
                {!video.gone && (
                  <p className="flex min-w-0 flex-col font-mono text-[11px] text-text-muted">
                    <span>{video.details}</span>
                    <span>{t('inspector.videoRangeFrames', { range: video.range, frames: video.frames })}</span>
                    {video.path && (
                      <span className="truncate" title={video.path}>
                        {video.path}
                      </span>
                    )}
                  </p>
                )}
                {!video.gone && <CopyLine copy={video.missing ? undefined : video.copy} lineRef={copyLine} />}
              </div>
              {!video.gone && !video.missing && video.preview && <ClipPreview {...video.preview} />}
              {!video.gone && video.lut && <LutPicker lut={video.lut} onLoad={onLoadLut} onSet={onSetLut} />}
              <div className="flex flex-wrap items-center gap-2">
                {!video.gone && (
                  <Button data-relink-video="" variant={video.missing ? 'primary' : 'secondary'} onClick={onRelinkVideo}>
                    {t('inspector.relink')}
                  </Button>
                )}
                {copyAction !== null && (
                  <Button
                    {...(copyAction === 'make' ? { 'data-make-copy': '' } : { 'data-cancel-copy': '' })}
                    onFocus={(event) => {
                      copyButton.current = event.currentTarget;
                    }}
                    onBlur={(event) => {
                      const button = event.currentTarget;
                      // Still there, and focus on something else: it moved on, so the button's going later isn't focus
                      // lost. (The window losing focus blurs it too, but leaves it the active element: kept.)
                      queueMicrotask(() => {
                        if (button.isConnected && document.activeElement !== button && copyButton.current === button) copyButton.current = null;
                      });
                    }}
                    onKeyDown={(event) => {
                      // A held key would make and cancel by turns as the button's job changes under it.
                      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
                    }}
                    onClick={(event) => {
                      // A double click's second click would cancel what the first just asked for.
                      if (event.detail > 1) return;
                      // Focus on the button, so it stays there as its job changes: a Mac's WebKit doesn't focus a
                      // button on a click.
                      event.currentTarget.focus();
                      (copyAction === 'make' ? onMakeCopy : onCancelCopy)?.();
                    }}
                  >
                    {copyAction === 'cancel' ? t('inspector.cancelCopy') : copyState === 'failed' ? t('inspector.copyTryAgain') : t('inspector.makeCopy')}
                  </Button>
                )}
                {!video.gone && !video.missing && onSaveClip && (
                  // While it works, the same button stops it: focus stays on it, and a long take can be given up on.
                  <Button data-save-clip="" onClick={savingClip ? onCancelSaveClip : onSaveClip}>
                    {savingClip ? t('saveClip.cancel') : t('saveClip.button')}
                  </Button>
                )}
                <Button
                  onClick={(event) => {
                    // The section goes with the video; focus stays nearby, on Link video….
                    const inspector = event.currentTarget.closest('[data-inspector]');
                    onUnlinkVideo?.();
                    requestAnimationFrame(() => {
                      inspector?.querySelector<HTMLElement>('[data-link-video]')?.focus();
                    });
                  }}
                >
                  {t('inspector.unlinkVideo')}
                </Button>
              </div>
            </Section>
          )}

          <Section title={t('inspectorView.camera')} start>
            <SegmentedControl
              label={t('inspectorView.size')}
              options={SHOT_SIZES.map((value) => ({ value, label: SHOT_SIZE_LABEL[value] }))}
              value={shot.fields.size ?? ''}
              onChange={(size) => {
                onShotChange({ set: { size } });
              }}
            />
            {lens && (
              // The frame's lens (6.1), from the project's in Gear: one edit per pick, its focal length with it.
              <Select
                label={t('inspector.lens')}
                value={lens.value}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  lens.onChange(id === '' ? null : id);
                }}
              >
                <option value="">{t('inspector.noLens')}</option>
                {lens.choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            )}
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
                  // Outside the picked lens's range: refused, never saved.
                  const range = lens?.range;
                  if (range && (mm < range.min || mm > range.max)) {
                    return range.min === range.max ? t('inspector.lensIsPrime', { mm: range.min }) : t('inspector.lensOutOfRange', { from: range.min, to: range.max });
                  }
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
            {lens && (
              // What the project's frame sees with the default body (6.1, decision 6): read only, worked out live.
              <div className="flex flex-col gap-[5px]" data-field-of-view="">
                <span className="sb-label">{t('inspector.fieldOfView')}</span>
                {'missing' in lens.fieldOfView ? (
                  <p className="text-[12px] text-text-muted">{t(FOV_MISSING[lens.fieldOfView.missing])}</p>
                ) : (
                  <p className="font-mono text-[13px]">{t('inspector.fov', lens.fieldOfView)}</p>
                )}
              </div>
            )}
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
            {/* Keyed by frame: the rows keep their order while this frame is open, and start over for the next. In the
                focus view (3.6c), your departments, then the rest under Rest of crew, each a grid of its own. */}
            <RestOfCrew
              fold="frame"
              departments={DEPARTMENTS}
              focus={focus}
              render={(rows, part, last) => (
                <DepartmentStatusTable
                  // The rows in the key too: a focus changed while this frame is open (Settings → Project) draws them anew.
                  key={`${shot.id}-${part}-${rows.join(',')}`}
                  statuses={shot.fields.departmentStatus}
                  seen={seen}
                  onEdit={(edit) => {
                    onDepartmentStatus?.(edit);
                  }}
                  {...(onOpenDepartment ? { onOpen: onOpenDepartment } : {})}
                  {...(part === 'all' ? {} : { rows, label: t(part === 'mine' ? 'restOfCrew.yoursOnFrame' : 'restOfCrew.restOnFrame') })}
                  legend={last}
                />
              )}
            />
            {/* Approved left the frame for the scene (3.6b): said here, where people looked for it. */}
            {approvals && <p className="text-[12px] text-text-muted">{t('departmentStatus.approvedPerScene', { scene: sceneLabel(s.number) })}</p>}
          </Section>

          {gear && <Section title={t('inspectorView.gear')}>{gear}</Section>}

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

      {approvals && <Section title={t('sceneApproval.title', { scene: sceneLabel(s.number) })}>{approvals}</Section>}

      {palette && <Section title={t('palette.title')}>{palette}</Section>}

      {boards && <Section title={t('moodboard.links.boardsLinked')}>{boards}</Section>}

      <Section title={t('inspectorView.links')}>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          <li className="flex justify-between gap-3">
            <span>{t('inspectorView.location')}</span>
            {/* The scene's, from the board's "/" menu; its details are in the Locations tile (3.3). */}
            {locationName ? (
              <span className="truncate font-semibold">{locationName}</span>
            ) : (
              <span className="sb-label text-text-muted">{t('inspectorView.onTheBoard')}</span>
            )}
          </li>
          {frameLocation && frameLocation.choices.length > 0 && (
            <li>
              <Select
                label={t('inspectorView.frameShotAt')}
                value={frameLocation.value}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  frameLocation.onChange(id === '' ? null : id);
                }}
              >
                <option value="">
                  {frameLocation.sceneName ? t('inspectorView.scenesLocation', { name: frameLocation.sceneName }) : t('inspectorView.scenesLocationNone')}
                </option>
                {frameLocation.choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </Select>
            </li>
          )}
          {shootDay !== undefined && (
            // The frame's day (5.11), read from its records, never copied: a button that opens the Shoot days tile on
            // it; muted words, not a button, when the frame is in no live day.
            <li data-inspector-shoot-day="" className="flex justify-between gap-3">
              <span>{t('inspector.shootDay')}</span>
              {shootDay ? (
                <button
                  type="button"
                  aria-label={t('inspector.openDay', { day: shootDay.label })}
                  onClick={shootDay.onOpen}
                  className="truncate text-right font-mono font-semibold hover:underline focus-visible:underline focus-visible:outline-offset-1"
                >
                  {shootDay.label}
                </button>
              ) : (
                <span className="sb-label text-text-muted">{t('inspector.notScheduled')}</span>
              )}
            </li>
          )}
          {setup && (
            // The frame's setup (6.0), from its scene's: one edit per pick, so one ⌘Z.
            <li data-inspector-setup="">
              <Select
                label={t('inspector.setup')}
                value={setup.value}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setup.onChange(value === '' ? { kind: 'none' } : value === NEW_SETUP ? { kind: 'new' } : { kind: 'join', id: value });
                }}
              >
                <option value="">{t('inspector.noSetup')}</option>
                {setup.choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
                <option value={NEW_SETUP}>{t('inspector.newSetup')}</option>
              </Select>
            </li>
          )}
          <li className="flex justify-between">
            <span>{t('inspector.birdsEye')}</span>
            <span className="sb-label text-text-muted">{t('phase.number', { phase: 6 })}</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}
