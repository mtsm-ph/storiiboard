import { useEffect, useRef } from 'react';
import { showInfo } from '../../../app/notice';
import { usePlanUnit } from '../../../app/planUnits';
import { useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { formatLength, hasGroupingComma, parseLength, type PlanUnit } from '../../../core/model/length';
import {
  isIcon,
  isOpening,
  isWallFields,
  keptInWall,
  openingFields,
  parseDegrees,
  planFields,
  planItemFields,
  roomTitle,
  sceneRoom,
  scenesUsingRoom,
  shownFields,
  wallEnds,
  type Hinge,
  type IconFields,
  type OpeningFields,
  type PlanItemFields,
  type Swing,
} from '../../../core/model/plan';
import { alsoInRoom, itemHome, itemLevel, scenesLosing, setupOnlyHeld } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import { Select, TextField, Toggle } from '../../../ui/fields';
import { Trans } from '../../../ui/Trans';
import { iconLabel } from './iconWords';
import { changeIcons, changeOpenings, changeWalls, renameRoom, setupOnly, type PlanView } from './planActions';
import { iconCentre, openingDistances, openingPatchChanges, viewKey, wallNeedOf, wallsTakeLength, type IconPatch, type OpeningPatch, type WallPatch } from './planItems';
import { usePlan } from './planStore';
import { AlsoIn, useLiveView } from './PlanTile';

// The Selection tile (6.2a, 6.2b), in the Setup workspace: the selected plan item's fields as it reads them, each typed
// and each one edit when it's left (one ⌘Z), lengths in the unit the screen shows and read in any form (src/core/model/
// length.ts); one that can't be read, or doesn't fit, snaps back and says so, and nothing is saved. Several selected:
// the fields they share, and a change goes to each. A door or window has its width, its distances from the wall's two
// ends, and a door its hinge and swing. With a setup shown, "This setup only" moves the selection into the setup's plan
// and back. Nothing selected: the room, its name, and how many scenes are set in it.

type Records = Readonly<Record<string, SbdRecord>>;

/** The value every one of them has, or null when they differ. */
function shared<T>(values: readonly T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((v) => v === first) ? first : null;
}

interface TypedFieldProps {
  label: string;
  /** What the field shows: '' for nothing set, or for several that differ. */
  text: string;
  /** Several selected with different values. */
  mixed?: boolean;
  /** Technical values (lengths, degrees) are mono; a name isn't. */
  mono?: boolean;
  /**
   * Reads what was typed: true when it was taken (and written), false to snap back saying `refused` when given, or the
   * words to say as it snaps back (a length that doesn't fit).
   */
  onCommit: (typed: string) => boolean | string;
  refused?: string;
}

/**
 * A field written when it's left or Enter is pressed, one edit each. The caller keys it by the item and the field,
 * never by its value: Enter keeps the focus in it, and what the records say (an undo, the tidy form of what was typed)
 * shows in it as it changes.
 */
function TypedField({ label, text, mixed = false, mono = true, onCommit, refused }: TypedFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.value = text;
  }, [text]);
  const commit = (field: HTMLInputElement) => {
    if (field.value.trim() === text) return;
    const taken = onCommit(field.value);
    // Taken: the field shows the value as the plan has it ("3.50 m" for "3.5"), even when it's the one already stored,
    // which changes nothing the field would hear of. A new value comes back through `text` once it's written.
    field.value = text;
    if (taken === true) return;
    const words = typeof taken === 'string' ? taken : refused;
    if (words !== undefined) showInfo(words);
  };
  return (
    <TextField
      ref={input}
      label={label}
      mono={mono}
      autoComplete="off"
      defaultValue={text}
      placeholder={mixed ? t('plan.field.mixed') : undefined}
      onBlur={(event) => {
        commit(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit(event.currentTarget);
      }}
    />
  );
}

/** "90°": a rotation in whole hundredths, as a technical value. */
const degreesText = (degrees: number): string => t('plan.degrees', { value: String(Math.round(degrees * 100) / 100) });

export function SelectionTile() {
  return (
    <div data-selection-tile="" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SelectionContent />
    </div>
  );
}

function SelectionContent() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const unit = usePlanUnit();
  const live = useLiveView(records);
  const key = live ? viewKey(live.view.sceneId, live.view.setupId) : '';
  const stored = usePlan((s) => s.selections[key]);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('plan.noProject')}</p>;
  if (!live) return <p className="p-3 text-[13px] text-text-muted">{t('plan.pick')}</p>;
  const selected = (stored ?? []).flatMap((id) => {
    const record = records[id];
    const fields = record?.type === 'plan_item' && record.trashedAt === null ? shownFields(record.props) : null;
    return fields ? [{ id, fields }] : [];
  });
  if (selected.length > 0) {
    const ids = selected.map((s) => s.id);
    const walls = selected.flatMap((s) => (isWallFields(s.fields) ? [s.fields] : []));
    const openings = selected.flatMap((s) => (isOpening(s.fields) ? [s.fields] : []));
    const icons = selected.flatMap((s) => (isIcon(s.fields) ? [s.fields] : []));
    // "This setup only" is for what belongs to the room or the scene (walls, set pieces): a setup's own icons are only its already.
    const movable = ids.some((id) => itemHome(records[id]?.props ?? {}) !== 'setup');
    return (
      <div className="flex flex-col gap-3 p-3" data-selection-items={ids.join(' ')}>
        {walls.length === selected.length ? (
          <WallFields ids={ids} walls={walls} unit={unit} records={records} view={live.view} />
        ) : openings.length === selected.length ? (
          <OpeningFieldsView ids={ids} openings={openings} unit={unit} records={records} view={live.view} />
        ) : icons.length === selected.length ? (
          <IconFieldsView ids={ids} icons={icons} unit={unit} />
        ) : (
          <p className="sb-label" data-selection-kind="">
            {tn('selection.items', selected.length)}
          </p>
        )}
        {live.view.setupId !== null && movable && <SetupOnlySwitch view={{ sceneId: live.view.sceneId, setupId: live.view.setupId }} ids={ids} records={records} />}
      </div>
    );
  }
  const room = sceneRoom(records, live.scene.id);
  if (!room) return <p className="p-3 text-[13px] text-text-muted">{t('selection.noRoom')}</p>;
  const fields = planFields(room.props);
  const scenes = scenesUsingRoom(records, room.id).length;
  return (
    <div className="flex flex-col gap-3 p-3" data-selection-room={room.id}>
      <p className="sb-label">{t('selection.room')}</p>
      <TypedField
        key={`room:${room.id}`}
        label={t('selection.roomName')}
        mono={false}
        text={roomTitle(fields)}
        onCommit={(typed) => {
          // Emptied, it goes back to its name: a room always has one.
          if (typed.trim() === '') return false;
          void renameRoom(room.id, typed.trim());
          return true;
        }}
      />
      <p className="text-[13px]" data-room-scenes={scenes}>
        {tn('selection.roomScenes', scenes)}
      </p>
      <AlsoIn scenes={alsoInRoom(records, live.scene.id)} />
    </div>
  );
}

/**
 * "This setup only" (6.2b): on when every selected item sits in the setup's own plan. Turned on, they move there, so
 * other setups and scenes no longer show them; off, back to the level each belongs to (the scene's room as it is now).
 * It can't be turned off with no room to go back to, nor for a door or window alone whose wall is this setup's only;
 * the words under it say why, and which scenes sharing the room would stop showing it.
 */
function SetupOnlySwitch({ view, ids, records }: { view: PlanView & { setupId: string }; ids: readonly string[]; records: Records }) {
  const on = ids.every((id) => itemLevel(records, view.sceneId, view.setupId, id) === 'setup');
  const held = on ? setupOnlyHeld(records, view.sceneId, view.setupId, ids) : null;
  const losing = on ? [] : scenesLosing(records, view.sceneId, view.setupId, ids);
  return (
    <div className="border-t border-border pt-3" data-setup-only={on ? 'on' : 'off'}>
      <Toggle
        label={t('selection.setupOnly')}
        checked={on}
        disabled={held !== null}
        onChange={(next) => {
          void setupOnly(view, ids, next);
        }}
      />
      <p className="mt-1 text-[12px] text-text-muted" data-setup-only-why={held ?? undefined}>
        {held === 'noRoom' ? t('selection.setupOnlyNoRoom') : held === 'wallOnly' ? t('selection.setupOnlyWallOnly') : t(on ? 'selection.setupOnlyOn' : 'selection.setupOnlyOff')}
      </p>
      {losing.length > 0 && (
        <p className="mt-1 text-[12px] text-text-muted" data-setup-only-losing={losing.join(' ')}>
          <Trans k="selection.setupOnlyLosing" parts={{ scenes: <span className="font-mono">{losing.join(', ')}</span> }} />
        </p>
      )}
    </div>
  );
}

/** A length field's commit: what's typed read in any form; `empty` is what an emptied field means, if it may be. */
const lengthCommit =
  <P,>(unit: PlanUnit, write: (patch: P) => boolean | string, apply: (m: number) => P, opts: { signed?: boolean; empty?: P } = {}) =>
  (typed: string): boolean | string => {
    if (typed.trim() === '' && opts.empty) return write(opts.empty);
    if (hasGroupingComma(typed)) return t('plan.groupingComma');
    const m = parseLength(typed, unit, opts.signed ?? false);
    if (m === null || (!opts.signed && m <= 0)) return false;
    return write(apply(m));
  };

function WallFields({ ids, walls, unit, records, view }: { ids: readonly string[]; walls: readonly PlanItemFields[]; unit: PlanUnit; records: Records; view: PlanView }) {
  const lengthText = (values: readonly number[]) => {
    const one = shared(values.map((v) => formatLength(v, unit)));
    return one ?? '';
  };
  const ends = walls.map((w) => wallEnds(w)[0]);
  const heights = walls.map((w) => (w.heightM === null ? '' : formatLength(w.heightM, unit)));
  const names = shared(walls.map((w) => w.name));
  const rotations = shared(walls.map((w) => degreesText(w.rotation)));
  const write = (patch: WallPatch): boolean | string => {
    // A wall is never shorter than its doors and windows need: refused, saying how long it must be.
    if (patch.length !== undefined && !wallsTakeLength(records, ids, patch.length, view)) {
      const need = Math.max(...ids.map((id) => wallNeedOf(records, id, view)));
      return t('selection.wallTooShort', { length: formatLength(need, unit) });
    }
    void changeWalls(ids, patch, view);
    return true;
  };
  const length = (apply: (m: number) => WallPatch, opts: { signed?: boolean; empty?: WallPatch } = {}) => lengthCommit(unit, write, apply, opts);
  const refused = t('selection.lengthRefused');
  // Each field keyed by the walls and the field, never by its value, so Enter keeps the focus in it.
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  return (
    <>
      <p className="sb-label" data-selection-kind="">
        {ids.length === 1 ? t('plan.item.wall') : tn('selection.walls', ids.length)}
      </p>
      <TypedField
        key={keyed('name')}
        label={t('selection.name')}
        mono={false}
        text={names ?? ''}
        mixed={names === null}
        onCommit={(typed) => write({ name: typed.trim() })}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('length')} label={t('selection.length')} text={lengthText(walls.map((w) => w.width))} mixed={lengthText(walls.map((w) => w.width)) === ''} onCommit={length((m) => ({ length: m }))} refused={refused} />
        <TypedField key={keyed('thickness')} label={t('selection.thickness')} text={lengthText(walls.map((w) => w.height))} mixed={lengthText(walls.map((w) => w.height)) === ''} onCommit={length((m) => ({ thickness: m }))} refused={refused} />
        <TypedField
          key={keyed('height')}
          label={t('selection.height')}
          text={shared(heights) ?? ''}
          mixed={shared(heights) === null}
          onCommit={length((m) => ({ heightM: m }), { empty: { heightM: null } })}
          refused={refused}
        />
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
        <TypedField key={keyed('x')} label={t('selection.x')} text={lengthText(ends.map((p) => p.x))} mixed={lengthText(ends.map((p) => p.x)) === ''} onCommit={length((m) => ({ startX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={lengthText(ends.map((p) => p.y))} mixed={lengthText(ends.map((p) => p.y)) === ''} onCommit={length((m) => ({ startY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.startNote')}</p>
    </>
  );
}

function OpeningFieldsView({ ids, openings, unit, records, view }: { ids: readonly string[]; openings: readonly OpeningFields[]; unit: PlanUnit; records: Records; view: PlanView }) {
  const text = (values: readonly (number | null)[]) => shared(values.map((v) => (v === null ? '' : formatLength(v, unit))));
  const distances = ids.flatMap((id) => {
    const o = openingFields(records[id]?.props ?? {});
    const wall = o ? planItemFields(records[o.wallId]?.props ?? {}) : null;
    // As the plan reads it: inside its wall.
    return o && wall ? [openingDistances(wall, keptInWall(o, wall.width))] : [];
  });
  const kind = shared(openings.map((o) => o.kind));
  const doors = kind === 'door';
  const names = shared(openings.map((o) => o.name));
  const hinge = shared(openings.map((o) => o.hinge));
  const swing = shared(openings.map((o) => o.swing));
  const write = (patch: OpeningPatch): boolean | string => {
    // A width or place that would run it off the wall or over another opening is refused, and nothing is saved.
    if (openingPatchChanges(records, ids, patch, view) === null) return t('selection.openingRefused');
    void changeOpenings(ids, patch, view);
    return true;
  };
  const length = (apply: (m: number) => OpeningPatch, opts: { empty?: OpeningPatch } = {}) => lengthCommit(unit, write, apply, opts);
  const refused = t('selection.lengthRefused');
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  const label = ids.length === 1 ? t(kind === 'door' ? 'plan.item.door' : 'plan.item.window') : kind === 'door' ? tn('selection.doors', ids.length) : kind === 'window' ? tn('selection.windows', ids.length) : tn('selection.openings', ids.length);
  const widthText = text(openings.map((o) => o.width));
  const startText = shared(distances.map((d) => formatLength(d.fromStart, unit)));
  const endText = shared(distances.map((d) => formatLength(d.fromEnd, unit)));
  const heightText = text(openings.map((o) => o.heightM));
  // A distance from an end may be 0 (the opening against the wall's end), never less.
  const distance = (apply: (m: number) => OpeningPatch) => (typed: string) => {
    if (hasGroupingComma(typed)) return t('plan.groupingComma');
    const m = parseLength(typed, unit, true);
    if (m === null || m < 0) return false;
    return write(apply(m));
  };
  return (
    <>
      <p className="sb-label" data-selection-kind="">
        {label}
      </p>
      <TypedField key={keyed('name')} label={t('selection.name')} mono={false} text={names ?? ''} mixed={names === null} onCommit={(typed) => write({ name: typed.trim() })} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('width')} label={t('selection.width')} text={widthText ?? ''} mixed={widthText === null} onCommit={length((m) => ({ width: m }))} refused={refused} />
        <TypedField key={keyed('fromStart')} label={t('selection.fromStart')} text={startText ?? ''} mixed={startText === null} onCommit={distance((m) => ({ fromStart: m }))} refused={refused} />
        <TypedField key={keyed('fromEnd')} label={t('selection.fromEnd')} text={endText ?? ''} mixed={endText === null} onCommit={distance((m) => ({ fromEnd: m }))} refused={refused} />
        <TypedField key={keyed('height')} label={t('selection.height')} text={heightText ?? ''} mixed={heightText === null} onCommit={length((m) => ({ heightM: m }), { empty: { heightM: null } })} refused={refused} />
      </div>
      {doors && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
          <Select
            label={t('selection.hinge')}
            value={hinge ?? ''}
            onChange={(event) => {
              if (event.target.value !== '') void changeOpenings(ids, { hinge: event.target.value as Hinge }, view);
            }}
          >
            {hinge === null && <option value="">{t('plan.field.mixed')}</option>}
            <option value="start">{t('selection.hinge.start')}</option>
            <option value="end">{t('selection.hinge.end')}</option>
          </Select>
          <Select
            label={t('selection.swing')}
            value={swing ?? ''}
            onChange={(event) => {
              if (event.target.value !== '') void changeOpenings(ids, { swing: event.target.value as Swing }, view);
            }}
          >
            {swing === null && <option value="">{t('plan.field.mixed')}</option>}
            <option value="left">{t('selection.swing.left')}</option>
            <option value="right">{t('selection.swing.right')}</option>
          </Select>
        </div>
      )}
      <p className="text-[12px] text-text-muted">{t(doors ? 'selection.doorNote' : 'selection.openingNote')}</p>
    </>
  );
}

/**
 * A library icon's fields (6.3): its name, width and depth, its real height, its rotation and its middle, each typed;
 * a new size or rotation keeps its middle where it is. Several: the fields they share, and a change goes to each.
 */
function IconFieldsView({ ids, icons, unit }: { ids: readonly string[]; icons: readonly IconFields[]; unit: PlanUnit }) {
  const text = (values: readonly (number | null)[]) => shared(values.map((v) => (v === null ? '' : formatLength(v, unit))));
  const write = (patch: IconPatch): boolean => {
    void changeIcons(ids, patch);
    return true;
  };
  const length = (apply: (m: number) => IconPatch, opts: { signed?: boolean; empty?: IconPatch } = {}) => lengthCommit(unit, write, apply, opts);
  const refused = t('selection.lengthRefused');
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  const kind = shared(icons.map((i) => i.icon));
  const label = ids.length === 1 && kind !== null ? iconLabel(kind) : tn('selection.items', ids.length);
  const names = shared(icons.map((i) => i.name));
  const rotations = shared(icons.map((i) => degreesText(i.rotation)));
  const centres = icons.map((i) => iconCentre(i));
  const widthText = text(icons.map((i) => i.width));
  const depthText = text(icons.map((i) => i.height));
  const heightText = text(icons.map((i) => i.heightM));
  const xText = text(centres.map((c) => c.x));
  const yText = text(centres.map((c) => c.y));
  return (
    <>
      <p className="sb-label" data-selection-kind="">
        {label}
      </p>
      <TypedField key={keyed('name')} label={t('selection.name')} mono={false} text={names ?? ''} mixed={names === null} onCommit={(typed) => write({ name: typed.trim() })} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('width')} label={t('selection.width')} text={widthText ?? ''} mixed={widthText === null} onCommit={length((m) => ({ width: m }))} refused={refused} />
        <TypedField key={keyed('depth')} label={t('selection.depth')} text={depthText ?? ''} mixed={depthText === null} onCommit={length((m) => ({ depth: m }))} refused={refused} />
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
      <p className="text-[12px] text-text-muted">{t('selection.iconNote')}</p>
    </>
  );
}
