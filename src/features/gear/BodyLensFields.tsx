import { useState } from 'react';
import { showInfo } from '../../app/notice';
import { t } from '../../core/i18n';
import { bodyFields, freeLetters, isFocal, isPrime, isSensorSize, isSqueeze, lensFields, SQUEEZES } from '../../core/model/cameraGear';
import type { SbdRecord } from '../../core/model/record';
import { cameraLabel, matchingMode, modeLabel, SENSOR_MODES, type SensorMode } from '../../core/model/sensorModes';
import type { Change } from '../../core/ops/ops';
import { Select, TextField } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { cameraLetterChange, lensRangeChange, lensSqueezeChange, sensorModeNameChange, sensorModePick, sensorSizeChange } from './gearEdits';

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
  /** Takes the number typed (null for an emptied field) or refuses it: false snaps it back with `refused`. */
  onCommit: (value: number | null) => boolean;
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
        if (event.currentTarget.value.trim() === text) return;
        if (!onCommit(readNumber(event.currentTarget.value))) {
          event.currentTarget.value = text;
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
  const body = bodyFields(props);
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

export function LensFieldsEditor({ id, props, edit }: Omit<FieldsProps, 'projectId' | 'records'>) {
  const lens = lensFields(props);
  const range = lens.range;
  // Kept while the item is open: a zoom whose ends are still the same reads as a zoom until it's set otherwise.
  const [type, setType] = useState<LensType>(range && !isPrime(lens) ? 'zoom' : 'prime');
  const preset = (SQUEEZES as readonly number[]).includes(lens.squeeze);
  const [typing, setTyping] = useState(!preset);
  const refused = t('gear.focalRefused');
  const setRange = (min: number | null, max: number | null) => {
    if (min === null || max === null || !isFocal(min) || !isFocal(max) || min > max) return false;
    void edit((now) => lensRangeChange(now, id, min, max));
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
          // A prime has one focal length: the zoom's wide end.
          if (next === 'prime' && range && range.min !== range.max) void edit((now) => lensRangeChange(now, id, range.min, range.min));
        }}
      />
      {type === 'prime' ? (
        <NumberField label={t('gear.focalLength')} value={range?.min ?? null} onCommit={(mm) => setRange(mm, mm)} refused={refused} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t('gear.focalFrom')} value={range?.min ?? null} onCommit={(mm) => setRange(mm, range ? range.max : mm)} refused={refused} />
          <NumberField label={t('gear.focalTo')} value={range?.max ?? null} onCommit={(mm) => setRange(range ? range.min : mm, mm)} refused={refused} />
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
