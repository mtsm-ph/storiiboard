import { useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { gearWatts, projectGear } from '../../../core/model/gear';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { parseDegrees, stopsAtWalls, type GripFields, type LightFields } from '../../../core/model/plan';
import { ALL_ROUND, beamOf, FRAME_SIZES, frameSizeOf, isAllRound, isBeam, isWatts, liesFlat, lightWatts, liveGear } from '../../../core/model/planLight';
import type { SbdRecord } from '../../../core/model/record';
import { Select, Toggle } from '../../../ui/fields';
import { frameLabel, iconLabel } from './iconWords';
import { wattsLabel } from './lightLooks';
import { changeIcons, setFrameSize, setLightBeam, setLightWatts, setPlanGear, setStopAtWalls } from './planActions';
import { iconCentre, iconPatchRefused, type IconPatch } from './planItems';
import { degreesText, lengthCommit, shared, TypedField } from './selectionFields';

// A light, a flag or a diffusion frame in the Selection tile (6.5, decisions 8 and 11). A light: the gear item it is
// (any of the project's, grip and electric's first), its watts (typed, or its gear item's read live, with a way to type
// over them), its beam angle or All round, its height, name, rotation and middle. A flag or diffusion frame: its gear
// item, its size by the name crews use (2×3 up to 20×20) or typed, its width (and depth, lying flat), height, name,
// rotation and middle. Each field is one edit when it's left (one ⌘Z).

type Records = Readonly<Record<string, SbdRecord>>;

/** The project's gear for a plan item's pick: grip and electric's first (lights, flags, frames), then the rest as Gear lists them. */
function gearChoices(records: Records, projectId: string): { id: string; name: string }[] {
  const all = projectGear(records, projectId);
  const first = all.filter((g) => g.fields.department === 'grip-electric');
  const rest = all.filter((g) => g.fields.department !== 'grip-electric');
  return [...first, ...rest].map((g) => ({ id: g.record.id, name: g.fields.name || t('gear.unnamed') }));
}

/** The gear item a selection is: one pick for all; "Mixed" while they differ. */
function GearPick({ ids, gearIds, records }: { ids: readonly string[]; gearIds: readonly (string | null)[]; records: Records }) {
  const project = useProject((s) => s.project);
  if (!project) return null;
  const choices = gearChoices(records, project.projectId);
  // A gear item in the Trash reads as none (its id stays, so a restore brings it back).
  const live = gearIds.map((id) => liveGear(records, id)?.id ?? '');
  const one = shared(live);
  return (
    <Select
      label={t('selection.light.gear')}
      value={one ?? 'mixed'}
      data-plan-gear=""
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (next !== 'mixed') void setPlanGear(ids, next === '' ? null : next);
      }}
    >
      {one === null && <option value="mixed">{t('plan.field.mixed')}</option>}
      <option value="">{t('selection.light.noGear')}</option>
      {choices.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </Select>
  );
}

/** A wattage typed: "650", "650 W", "1,200", "1.200" (a separator before three digits groups them), "7,5". */
export function parseWatts(typed: string): number | null {
  const bare = typed.trim().replace(/\s*w$/i, '').replace(/\s/g, '');
  const grouped = /^\d{1,3}([,.]\d{3})+$/.test(bare) ? bare.replace(/[,.]/g, '') : bare.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(grouped)) return null;
  const watts = Number(grouped);
  return isWatts(watts) ? watts : null;
}

/** A beam angle typed: "40", "40°", or the words for all round (360). */
export function parseBeam(typed: string): number | null {
  const text = typed.trim();
  if (text.toLocaleLowerCase() === t('selection.light.allRound').toLocaleLowerCase()) return ALL_ROUND;
  // A beam is never negative: parseDegrees would wrap "-30" to 330° (6.5 review).
  if (/^[-−]/.test(text)) return null;
  // 360 is all round, never a turn's 0: read before parseDegrees, which folds it.
  const plain = text.replace(/°$/, '').trim().replace(',', '.');
  if (/^(\d+(\.\d*)?|\.\d+)$/.test(plain)) {
    const degrees = Number(plain);
    return isBeam(degrees) ? degrees : null;
  }
  const degrees = parseDegrees(text);
  return degrees !== null && isBeam(degrees) ? degrees : null;
}

/** "All round", or "40°". */
export const beamText = (degrees: number): string => (isAllRound(degrees) ? t('selection.light.allRound') : degreesText(degrees));

export function LightFieldsView({ id, fields, unit, records }: { id: string; fields: LightFields; unit: PlanUnit; records: Records }) {
  const keyed = (field: string) => `${id}:${field}`;
  const write = (patch: IconPatch): boolean => {
    if (iconPatchRefused(records, [id], patch)) return false;
    void changeIcons([id], patch);
    return true;
  };
  const length = (apply: (m: number) => IconPatch, opts: { signed?: boolean; empty?: IconPatch } = {}) => lengthCommit(unit, write, apply, opts);
  const refused = t('selection.lengthRefused');
  const centre = iconCentre(fields);
  const watts = lightWatts(records, id);
  const gear = liveGear(records, fields.gearId);
  const gearHas = gear ? gearWatts(gear.props) : null;
  const beam = beamOf(fields);
  return (
    <div className="flex flex-col gap-3" data-light={id}>
      <p className="sb-label" data-selection-kind="">
        {iconLabel(fields.icon)}
      </p>
      <TypedField key={keyed('name')} label={t('selection.name')} mono={false} text={fields.name} onCommit={(typed) => write({ name: typed.trim() })} />
      <GearPick ids={[id]} gearIds={[fields.gearId]} records={records} />
      <div className="flex flex-col gap-[5px]" data-light-watts={watts?.from ?? 'none'}>
        <TypedField
          key={keyed('watts')}
          label={t('selection.light.watts')}
          text={fields.watts === null ? '' : String(fields.watts)}
          onCommit={(typed) => {
            if (typed.trim() === '') {
              void setLightWatts([id], null);
              return true;
            }
            const next = parseWatts(typed);
            if (next === null) return t('selection.light.wattsRefused');
            void setLightWatts([id], next);
            return true;
          }}
        />
        {watts?.from === 'gear' ? (
          <p className="text-[12px]" data-light-watts-from="gear">
            {t('selection.light.wattsFromGear', { watts: wattsLabel(watts.watts) })}
          </p>
        ) : fields.watts !== null && gearHas !== null ? (
          <p className="text-[12px] text-text-muted">{t('selection.light.wattsOverGear', { watts: wattsLabel(gearHas) })}</p>
        ) : null}
      </div>
      <TypedField
        key={keyed('beam')}
        label={t('selection.light.beam')}
        text={beamText(beam)}
        onCommit={(typed) => {
          const next = parseBeam(typed);
          if (next === null) return t('selection.light.beamRefused');
          void setLightBeam([id], next);
          return true;
        }}
      />
      {/* Walls stop its beam (6.18); off for a wild wall, flown out for the shot. */}
      <Toggle label={t('selection.stopAtWalls')} checked={stopsAtWalls(fields)} onChange={(on) => void setStopAtWalls([id], on)} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField
          key={keyed('height')}
          label={t('selection.height')}
          text={fields.heightM === null ? '' : formatLength(fields.heightM, unit)}
          onCommit={length((m) => ({ heightM: m }), { empty: { heightM: null } })}
          refused={refused}
        />
        <TypedField
          key={keyed('rotation')}
          label={t('selection.rotation')}
          text={degreesText(fields.rotation)}
          onCommit={(typed) => {
            const degrees = parseDegrees(typed);
            if (degrees === null) return false;
            return write({ rotation: degrees });
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField key={keyed('x')} label={t('selection.x')} text={formatLength(centre.x, unit)} onCommit={length((m) => ({ centreX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={formatLength(centre.y, unit)} onCommit={length((m) => ({ centreY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.light.note')}</p>
    </div>
  );
}

export function GripFieldsView({ ids, frames, unit, records }: { ids: readonly string[]; frames: readonly GripFields[]; unit: PlanUnit; records: Records }) {
  const text = (values: readonly (number | null)[]) => shared(values.map((v) => (v === null ? '' : formatLength(v, unit))));
  const write = (patch: IconPatch): boolean => {
    if (iconPatchRefused(records, ids, patch)) return false;
    void changeIcons(ids, patch);
    return true;
  };
  const length = (apply: (m: number) => IconPatch, opts: { signed?: boolean; empty?: IconPatch } = {}) => lengthCommit(unit, write, apply, opts);
  const refused = t('selection.lengthRefused');
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  // By its kind and size, never the icon it was placed as (6.5 review): "Diffusion · 8×8".
  const only = ids.length === 1 ? frames[0] : undefined;
  const label = only ? frameLabel(only, unit) : tn('selection.items', ids.length);
  const names = shared(frames.map((f) => f.name));
  const rotations = shared(frames.map((f) => degreesText(f.rotation)));
  const centres = frames.map((f) => iconCentre(f));
  const sizes = frames.map((f) => frameSizeOf(f)?.id ?? '');
  const size = shared(sizes);
  const flat = frames.every((f) => liesFlat(f.icon));
  const widthText = text(frames.map((f) => f.width));
  const depthText = text(frames.map((f) => f.height));
  const heightText = text(frames.map((f) => f.heightM));
  const xText = text(centres.map((c) => c.x));
  const yText = text(centres.map((c) => c.y));
  return (
    <div className="flex flex-col gap-3" data-plan-frame={ids.join(' ')}>
      <p className="sb-label" data-selection-kind="">
        {label}
      </p>
      <TypedField key={keyed('name')} label={t('selection.name')} mono={false} text={names ?? ''} mixed={names === null} onCommit={(typed) => write({ name: typed.trim() })} />
      <GearPick ids={ids} gearIds={frames.map((f) => f.gearId)} records={records} />
      <Select
        label={t('selection.frame.size')}
        mono
        value={size ?? 'mixed'}
        data-frame-size={size ?? 'mixed'}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (FRAME_SIZES.some((s) => s.id === next)) void setFrameSize(ids, next);
        }}
      >
        {size === null && <option value="mixed">{t('plan.field.mixed')}</option>}
        {size === '' && <option value="">{t('selection.frame.typed')}</option>}
        {FRAME_SIZES.map((s) => (
          <option key={s.id} value={s.id}>
            {t('selection.frame.sizeOption', { across: String(s.feet[0]), long: String(s.feet[1]) })}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('width')} label={t('selection.width')} text={widthText ?? ''} mixed={widthText === null} onCommit={length((m) => ({ width: m }))} refused={refused} />
        {flat && <TypedField key={keyed('depth')} label={t('selection.depth')} text={depthText ?? ''} mixed={depthText === null} onCommit={length((m) => ({ depth: m }))} refused={refused} />}
        <TypedField key={keyed('height')} label={t('selection.height')} text={heightText ?? ''} mixed={heightText === null} onCommit={length((m) => ({ heightM: m }), { empty: { heightM: null } })} refused={refused} />
        <TypedField
          key={keyed('rotation')}
          label={t('selection.rotation')}
          text={rotations ?? ''}
          mixed={rotations === null}
          onCommit={(typed) => {
            const degrees = parseDegrees(typed);
            if (degrees === null) return false;
            return write({ rotation: degrees });
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField key={keyed('x')} label={t('selection.x')} text={xText ?? ''} mixed={xText === null} onCommit={length((m) => ({ centreX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={yText ?? ''} mixed={yText === null} onCommit={length((m) => ({ centreY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.frame.note')}</p>
    </div>
  );
}
