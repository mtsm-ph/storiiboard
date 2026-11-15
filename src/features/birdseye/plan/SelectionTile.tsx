import { usePlanUnit } from '../../../app/planUnits';
import { useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { formatLength, hasGroupingComma, parseLength, type PlanUnit } from '../../../core/model/length';
import {
  isCamera,
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
  type BoxFields,
  type Hinge,
  type OpeningFields,
  type PlanItemFields,
  type Swing,
} from '../../../core/model/plan';
import { alsoInRoom, itemHome, itemLevel, scenesLosing, setupOnlyHeld, setupOnlyOthers, type PlanPlace } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import { Select, Toggle } from '../../../ui/fields';
import { Trans } from '../../../ui/Trans';
import { iconLabel } from './iconWords';
import { changeIcons, changeOpenings, changeWalls, renameRoom, setupOnly, type PlanView } from './planActions';
import { iconCentre, iconPatchRefused, openingDistances, openingPatchChanges, viewKey, wallNeedIn, wallPatchRefused, wallsTakeLength, type IconPatch, type OpeningPatch, type WallPatch } from './planItems';
import { usePlan } from './planStore';
import { AlsoIn, useLiveView } from './PlanTile';
import { CameraFieldsView } from './CameraSelection';
import { degreesText, lengthCommit, shared, TypedField } from './selectionFields';

// The Selection tile (6.2a, 6.2b), in the Setup workspace: the selected plan item's fields as it reads them, each typed
// and each one edit when it's left (one ⌘Z), lengths in the unit the screen shows and read in any form (src/core/model/
// length.ts); one that can't be read, or doesn't fit, snaps back and says so, and nothing is saved. Several selected:
// the fields they share, and a change goes to each. A door or window has its width, its distances from the wall's two
// ends, and a door its hinge and swing. With a setup shown, "This setup only" moves the selection into the setup's plan
// and back. Nothing selected: the room, its name, and how many scenes are set in it.

type Records = Readonly<Record<string, SbdRecord>>;

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
    const icons = selected.flatMap((s) => (isIcon(s.fields) || isCamera(s.fields) ? [s.fields] : []));
    const [camera] = selected.flatMap((s) => (isCamera(s.fields) ? [s] : []));
    // "This setup only" is for what belongs to the room or the scene (walls, set pieces): a setup's own icons are only its already.
    const movable = ids.some((id) => itemHome(records[id]?.props ?? {}) !== 'setup');
    return (
      <div className="flex flex-col gap-3 p-3" data-selection-items={ids.join(' ')}>
        {walls.length === selected.length ? (
          <WallFields ids={ids} walls={walls} unit={unit} records={records} view={live.view} />
        ) : openings.length === selected.length ? (
          <OpeningFieldsView ids={ids} openings={openings} unit={unit} records={records} view={live.view} />
        ) : camera && selected.length === 1 && isCamera(camera.fields) ? (
          // A camera (6.4): its body, its frames, its lens, its field of view.
          <CameraFieldsView id={camera.id} fields={camera.fields} unit={unit} records={records} />
        ) : icons.length === selected.length ? (
          <IconFieldsView ids={ids} icons={icons} unit={unit} records={records} />
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
  const held = setupOnlyHeld(records, view.sceneId, view.setupId, ids);
  const losing = on || held !== null ? [] : scenesLosing(records, view.sceneId, view.setupId, ids);
  const others = held === 'others' ? setupOnlyOthers(records, view.sceneId, view.setupId, ids) : [];
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
        {held === 'noRoom' ? (
          t('selection.setupOnlyNoRoom')
        ) : held === 'wallOnly' ? (
          t('selection.setupOnlyWallOnly')
        ) : held === 'others' ? (
          <Trans k="selection.setupOnlyOthers" parts={{ places: <PlaceList places={others} /> }} />
        ) : (
          t(on ? 'selection.setupOnlyOn' : 'selection.setupOnlyOff')
        )}
      </p>
      {losing.length > 0 && (
        <p className="mt-1 text-[12px] text-text-muted" data-setup-only-losing={losing.join(' ')}>
          <Trans k="selection.setupOnlyLosing" parts={{ scenes: <span className="font-mono">{losing.join(', ')}</span> }} />
        </p>
      )}
    </div>
  );
}

/** "SC 02, Setup 2": scene numbers and setup numbers in mono, joined as a list. */
function PlaceList({ places }: { places: readonly PlanPlace[] }) {
  return (
    <span data-setup-only-places={places.map((p) => (p.setup === null ? p.scene : `${p.scene}:${String(p.setup)}`)).join(' ')}>
      {places.map((place, i) => (
        <span key={`${place.scene}:${String(place.setup)}`}>
          {i > 0 && ', '}
          {place.setup === null ? <span className="font-mono">{place.scene}</span> : <Trans k="setup.label" parts={{ number: <span className="font-mono">{place.setup}</span> }} />}
        </span>
      ))}
    </span>
  );
}

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
    // A wall is never shorter than its doors and windows need, every plan's: refused, saying how long it must be, and
    // where the door is when this view doesn't show it (6.2b review).
    if (patch.length !== undefined && !wallsTakeLength(records, ids, patch.length)) {
      const need = wallNeedIn(records, ids, view);
      const length = formatLength(need.length, unit);
      if (need.hidden) return t(need.hidden.kind === 'door' ? 'selection.wallTooShortDoorIn' : 'selection.wallTooShortWindowIn', { place: need.hidden.place, length });
      return t('selection.wallTooShort', { length });
    }
    // Past the plan's reach or size it would vanish: refused, nothing saved (6.3 review).
    if (wallPatchRefused(records, ids, patch)) return false;
    void changeWalls(ids, patch);
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
  // As the plan draws them: inside the wall, its width and both distances (6.2b review), with what is stored besides.
  const read = ids.flatMap((id) => {
    const o = openingFields(records[id]?.props ?? {});
    const wall = o ? planItemFields(records[o.wallId]?.props ?? {}) : null;
    if (!o || !wall) return [];
    const kept = keptInWall(o, wall.width);
    return [{ stored: o, kept, distances: openingDistances(wall, kept), storedDistances: openingDistances(wall, o) }];
  });
  const distances = read.map((r) => r.distances);
  const [only] = read;
  const clamped = read.length === 1 && only && (only.kept.width !== only.stored.width || only.kept.along !== only.stored.along) ? only : null;
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
  const widthText = text(read.length === openings.length ? read.map((r) => r.kept.width) : openings.map((o) => o.width));
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
      {clamped && (
        <p className="text-[12px] text-text-muted" data-opening-stored="">
          {clamped.kept.width !== clamped.stored.width ? (
            <Trans k="selection.storedWidth" parts={{ width: <span className="font-mono">{formatLength(clamped.stored.width, unit)}</span> }} />
          ) : (
            <Trans k="selection.storedPlace" parts={{ distance: <span className="font-mono">{formatLength(clamped.storedDistances.fromStart, unit)}</span> }} />
          )}
        </p>
      )}
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
function IconFieldsView({ ids, icons, unit, records }: { ids: readonly string[]; icons: readonly BoxFields[]; unit: PlanUnit; records: Records }) {
  const text = (values: readonly (number | null)[]) => shared(values.map((v) => (v === null ? '' : formatLength(v, unit))));
  const write = (patch: IconPatch): boolean => {
    // Under a centimetre, or past the plan's reach or size: refused, nothing saved (6.3 review).
    if (iconPatchRefused(records, ids, patch)) return false;
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
