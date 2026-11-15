import { useState } from 'react';
import { ask } from '../../app/ask';
import { showInfo } from '../../app/notice';
import { t, tn } from '../../core/i18n';
import { bodyFields, focalLabel, freeLetters, isFocal, isPrime, isSensorSize, isSqueeze, lensFields, lensSpec, projectBodyFields, SQUEEZES } from '../../core/model/cameraGear';
import type { SbdRecord } from '../../core/model/record';
import { cameraLabel, matchingMode, modeLabel, SENSOR_MODES, type SensorMode } from '../../core/model/sensorModes';
import type { Change } from '../../core/ops/ops';
import { Select, TextField } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { cameraLetterChange, framesOutsideRange, lensRangeChange, lensSqueezeChange, sensorModeNameChange, sensorModePick, sensorSizeChange } from './gearEdits';

// A camera body's and a lens's own fields in the Gear tile (6.1). A body: the camera and recording mode picked from
// the short table (src/core/model/sensorModes.ts), which fills the mode's name, width and height, each still typed
// over by hand; and its camera letter. A lens: prime or zoom, its focal range, and its squeeze. Each field is one edit
// when it's left, so one ⌘Z; a value that can't be taken snaps back and says why.

type Records = Readonly<Record<string, SbdRecord>>;
type Edit = (build: (now: Records) => Change[]) => Promise<boolean>;

interface FieldsProps {
  id: string;
  projectId: string;
  records: Records;
  props: SbdRecord['props'];
  edit: Edit;
}

const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') event.currentTarget.blur();
};

/** "35.6" for 35.6; '' for none. Figures, never the language's decimals: they're technical values. */
const mmText = (mm: number | null): string => (mm === null ? '' : String(mm));

/** A number typed in mm (or a squeeze): '' for none, NaN for text that isn't one. "35mm" reads as 35. */
const readNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(/\s*mm$/i, '').replace(/×$/, '');
  return trimmed === '' ? null : /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
};

interface NumberFieldProps {
  label: string;
  value: number | null;
  /**
   * Takes the number typed (null for an emptied field) or refuses it: false snaps it back with `refused`. One that asks
   * first calls `revert` when the person says no, so the field shows the stored value again.
   */
  onCommit: (value: number | null, revert: () => void) => boolean;
  refused: string;
}

function NumberField({ label, value, onCommit, refused }: NumberFieldProps) {
  const text = mmText(value);
  return (
    <TextField
      // Keyed by the value, so an undo shows in the field it changed.
      key={`${label}:${text}`}
      label={label}
      mono
      inputMode="decimal"
      autoComplete="off"
      defaultValue={text}
      onBlur={(event) => {
        const input = event.currentTarget;
        if (input.value.trim() === text) return;
        const revert = () => {
          input.value = text;
        };
        if (!onCommit(readNumber(input.value), revert)) {
          revert();
          showInfo(refused);
        }
      }}
      onKeyDown={blurOnEnter}
    />
  );
}

/** The table by camera, in its order. */
const CAMERAS: readonly (readonly SensorMode[])[] = Object.values(
  SENSOR_MODES.reduce<Record<string, SensorMode[]>>((out, entry) => {
    const key = entry.camera ?? '';
    (out[key] ??= []).push(entry);
    return out;
  }, {}),
);

export function BodyFieldsEditor({ id, projectId, records, props, edit }: FieldsProps) {
  // As the project reads it: a letter an earlier body holds (one restored beside the body that took it) reads as none.
  const body = projectBodyFields(records, projectId, id) ?? bodyFields(props);
  const matched = matchingMode(body.sensorMode, body.sensorWidthMm, body.sensorHeightMm);
  const letters = freeLetters(records, projectId, id);
  const sizeCommit = (prop: 'sensor_width_mm' | 'sensor_height_mm') => (mm: number | null) => {
    if (mm !== null && !isSensorSize(mm)) return false;
    void edit((now) => sensorSizeChange(now, id, prop, mm));
    return true;
  };
  return (
    <div className="flex flex-col gap-3" data-body-fields="">
      <Select
        label={t('gear.cameraMode')}
        value={matched?.id ?? ''}
        onChange={(event) => {
          const modeId = event.currentTarget.value;
          if (modeId !== '') void edit((now) => sensorModePick(now, id, modeId));
        }}
      >
        <option value="">{body.sensorMode === '' && body.sensorWidthMm === null && body.sensorHeightMm === null ? t('gear.cameraModePick') : t('gear.cameraModeTyped')}</option>
        {CAMERAS.map((modes) => {
          const [first] = modes;
          if (!first) return null;
          const camera = cameraLabel(first);
          return (
            <optgroup key={camera} label={camera}>
              {modes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t('gear.cameraModeOption', { camera, mode: modeLabel(entry.mode), width: entry.widthMm, height: entry.heightMm })}
                </option>
              ))}
            </optgroup>
          );
        })}
      </Select>
      <TextField
        key={`mode:${body.sensorMode}`}
        label={t('gear.sensorMode')}
        autoComplete="off"
        defaultValue={modeLabel(body.sensorMode)}
        onBlur={(event) => {
          const typed = event.currentTarget.value.trim();
          // Untouched (the phones entry reads in the app's language), nothing is written.
          if (typed === modeLabel(body.sensorMode)) return;
          void edit((now) => sensorModeNameChange(now, id, typed));
        }}
        onKeyDown={blurOnEnter}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <NumberField label={t('gear.sensorWidth')} value={body.sensorWidthMm} onCommit={sizeCommit('sensor_width_mm')} refused={t('gear.sensorRefused')} />
        <NumberField label={t('gear.sensorHeight')} value={body.sensorHeightMm} onCommit={sizeCommit('sensor_height_mm')} refused={t('gear.sensorRefused')} />
        <Select
          label={t('gear.cameraLetter')}
          mono
          value={body.letter ?? ''}
          onChange={(event) => {
            const letter = event.currentTarget.value;
            if (letter !== '') void edit((now) => cameraLetterChange(now, id, letter));
          }}
        >
          {body.letter === null && <option value="">{t('gear.noCameraLetter')}</option>}
          {letters.map((letter) => (
            <option key={letter} value={letter}>
              {t('gear.cameraLetterOption', { letter })}
            </option>
          ))}
        </Select>
      </div>
      {body.focalEquivalent && <p className="text-[12px]">{t('gear.focalEquivalentNote')}</p>}
    </div>
  );
}

type LensType = 'prime' | 'zoom';
const OTHER_SQUEEZE = 'other';

/**
 * What the Gear tile asks before a range that would leave frames outside it: which lens (the question can open after
 * the editor moved on to another item), how many, how many more in the Trash, and the focal length they'll take. Null
 * when no live frame would change: frames only in the Trash are set in the same edit without asking.
 */
export function clampQuestion(records: Records, id: string, min: number, max: number): string | null {
  const outside = framesOutsideRange(records, id, min, max);
  const count = outside.filter((f) => !f.trashed).length;
  if (count === 0) return null;
  const trashed = outside.length - count;
  const props = records[id]?.props ?? {};
  const named = typeof props.name === 'string' ? props.name.trim() : '';
  const lens = named === '' ? lensSpec(lensFields(props)) : named;
  const first = min === max ? tn('gear.clampOther', count, { lens }) : tn('gear.clampOutside', count, { lens, range: focalLabel({ min, max }) });
  const also = trashed > 0 ? [tn('gear.clampTrashed', trashed)] : [];
  const ends = new Set(outside.map((f) => f.mm));
  const then = ends.size === 1 ? tn('gear.clampTo', outside.length, { mm: [...ends][0] ?? min }) : t('gear.clampNearest', { from: min, to: max });
  return [first, ...also, then].join(' ');
}

/** A lens's range as a key, so the editor can tell when it changed. */
const rangeKey = (range: { min: number; max: number } | null): string => (range ? `${String(range.min)}–${String(range.max)}` : '');

/** Prime or zoom as the stored range says: a zoom when its ends differ, else a prime. */
const typeOf = (lens: ReturnType<typeof lensFields>): LensType => (lens.range && !isPrime(lens) ? 'zoom' : 'prime');

export function LensFieldsEditor({ id, records, props, edit }: Omit<FieldsProps, 'projectId'>) {
  const lens = lensFields(props);
  const range = lens.range;
  const key = rangeKey(range);
  // Prime or zoom, kept while the item is open: a zoom whose ends are still the same (Zoom picked, one end typed)
  // reads as a zoom until it's set otherwise. `key` is the range it was worked out for; `expected`, the range this
  // editor's own last edit asked for. When the stored range changes to anything else (an undo, a redo, History), the
  // choice is worked out again from it, so the editor never shows Prime over a zoom.
  const [choice, setChoice] = useState<{ type: LensType; key: string; expected: string | null }>(() => ({ type: typeOf(lens), key, expected: null }));
  let type = choice.type;
  if (choice.key !== key) {
    type = choice.expected === key ? choice.type : typeOf(lens);
    // Adjusted while rendering, as React has it for state that follows a prop: no extra render of the old choice.
    setChoice({ type, key, expected: null });
  }
  const setType = (next: LensType) => {
    setChoice((c) => ({ ...c, type: next }));
  };
  const preset = (SQUEEZES as readonly number[]).includes(lens.squeeze);
  const [typing, setTyping] = useState(!preset);
  const refused = t('gear.focalRefused');
  const write = (min: number, max: number) => {
    setChoice((c) => ({ ...c, expected: rangeKey({ min, max }) }));
    void edit((now) => lensRangeChange(now, id, min, max));
  };
  /**
   * A new range, asked first when frames using the lens would fall outside it (each then takes its nearer end, in the
   * same edit). `cancelled` puts the field or the switch back when the person says no.
   */
  const changeRange = (min: number, max: number, cancelled: () => void) => {
    const question = clampQuestion(records, id, min, max);
    if (question === null) {
      write(min, max);
      return;
    }
    // Asked once the key that left the field is done: Enter's own keypress would otherwise land on the window's first
    // button (Cancel) and answer it at once.
    window.setTimeout(() => {
      void ask({
        title: t('gear.clampTitle'),
        text: question,
        choices: [
          { id: 'cancel', label: t('common.cancel') },
          { id: 'change', label: t('gear.clampConfirm'), variant: 'primary' },
        ],
        cancel: 'cancel',
      }).then((answer) => {
        if (answer === 'change') write(min, max);
        else cancelled();
      });
    }, 0);
  };
  const setRange = (min: number | null, max: number | null, revert: () => void) => {
    if (min === null || max === null || !isFocal(min) || !isFocal(max) || min > max) return false;
    changeRange(min, max, revert);
    return true;
  };
  const squeezeCommit = (value: number | null) => {
    if (value === null || !isSqueeze(value)) return false;
    void edit((now) => lensSqueezeChange(now, id, value));
    return true;
  };
  return (
    <div className="flex flex-col gap-3" data-lens-fields="">
      <SegmentedControl<LensType>
        label={t('gear.lensType')}
        options={[
          { value: 'prime', label: t('gear.prime') },
          { value: 'zoom', label: t('gear.zoom') },
        ]}
        value={type}
        onChange={(next) => {
          setType(next);
          // A prime has one focal length: the zoom's wide end. Said no to, it stays a zoom.
          if (next === 'prime' && range && range.min !== range.max) {
            changeRange(range.min, range.min, () => {
              setType('zoom');
            });
          }
        }}
      />
      {type === 'prime' ? (
        <NumberField label={t('gear.focalLength')} value={range?.min ?? null} onCommit={(mm, revert) => setRange(mm, mm, revert)} refused={refused} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t('gear.focalFrom')} value={range?.min ?? null} onCommit={(mm, revert) => setRange(mm, range ? range.max : mm, revert)} refused={refused} />
          <NumberField label={t('gear.focalTo')} value={range?.max ?? null} onCommit={(mm, revert) => setRange(range ? range.min : mm, mm, revert)} refused={refused} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t('gear.squeeze')}
          mono
          value={typing ? OTHER_SQUEEZE : String(lens.squeeze)}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === OTHER_SQUEEZE) {
              setTyping(true);
              return;
            }
            setTyping(false);
            void edit((now) => lensSqueezeChange(now, id, Number(value)));
          }}
        >
          {SQUEEZES.map((s) => (
            <option key={s} value={String(s)}>
              {s === 1 ? t('gear.squeezeSpherical') : t('gear.squeezeOption', { squeeze: s })}
            </option>
          ))}
          <option value={OTHER_SQUEEZE}>{t('gear.squeezeOther')}</option>
        </Select>
        {typing && <NumberField label={t('gear.squeezeTyped')} value={lens.squeeze} onCommit={squeezeCommit} refused={t('gear.squeezeRefused')} />}
      </div>
    </div>
  );
}
