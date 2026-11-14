import { useEffect, useRef } from 'react';
import { showInfo } from '../../../app/notice';
import { usePlanUnit } from '../../../app/planUnits';
import { useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { formatLength, parseLength, type PlanUnit } from '../../../core/model/length';
import { parseDegrees, planFields, planItemFields, roomTitle, sceneRoom, scenesUsingRoom, wallEnds, type PlanItemFields } from '../../../core/model/plan';
import { TextField } from '../../../ui/fields';
import { changeWalls, renameRoom } from './planActions';
import { viewKey, type WallPatch } from './planItems';
import { usePlan } from './planStore';
import { useLiveView } from './PlanTile';

// The Selection tile (6.2a), in the Setup workspace: the selected plan item's fields as it reads them, each typed and
// each one edit when it's left (one ⌘Z), lengths in the unit the screen shows and read in any form (src/core/model/
// length.ts); one that can't be read snaps back and says so, and nothing is saved. Several selected: the fields they
// share, and a change goes to each. Nothing selected: the room, its name, and how many scenes are set in it.

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
  /** Reads what was typed: true when it was taken (and written), false to snap back, saying `refused` when given. */
  onCommit: (typed: string) => boolean;
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
    if (!onCommit(field.value)) {
      field.value = text;
      if (refused !== undefined) showInfo(refused);
    }
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
    const fields = record?.type === 'plan_item' && record.trashedAt === null ? planItemFields(record.props) : null;
    return fields ? [{ id, fields }] : [];
  });
  if (selected.length > 0) return <WallFields ids={selected.map((s) => s.id)} walls={selected.map((s) => s.fields)} unit={unit} />;
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
    </div>
  );
}

function WallFields({ ids, walls, unit }: { ids: readonly string[]; walls: readonly PlanItemFields[]; unit: PlanUnit }) {
  const lengthText = (values: readonly number[]) => {
    const one = shared(values.map((v) => formatLength(v, unit)));
    return one ?? '';
  };
  const ends = walls.map((w) => wallEnds(w)[0]);
  const heights = walls.map((w) => (w.heightM === null ? '' : formatLength(w.heightM, unit)));
  const names = shared(walls.map((w) => w.name));
  const rotations = shared(walls.map((w) => degreesText(w.rotation)));
  const write = (patch: WallPatch) => {
    void changeWalls(ids, patch);
  };
  /** A length field's commit: what's typed read in any form; `empty` is what an emptied field means, if it may be. */
  const length = (apply: (m: number) => WallPatch, opts: { signed?: boolean; empty?: WallPatch } = {}) => (typed: string): boolean => {
    if (typed.trim() === '' && opts.empty) {
      write(opts.empty);
      return true;
    }
    const m = parseLength(typed, unit, opts.signed ?? false);
    if (m === null || (!opts.signed && m <= 0)) return false;
    write(apply(m));
    return true;
  };
  const refused = t('selection.lengthRefused');
  // Each field keyed by the walls and the field, never by its value, so Enter keeps the focus in it.
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  return (
    <div className="flex flex-col gap-3 p-3" data-selection-items={ids.join(' ')}>
      <p className="sb-label" data-selection-kind="">
        {ids.length === 1 ? t('plan.item.wall') : tn('selection.walls', ids.length)}
      </p>
      <TypedField
        key={keyed('name')}
        label={t('selection.name')}
        mono={false}
        text={names ?? ''}
        mixed={names === null}
        onCommit={(typed) => {
          write({ name: typed.trim() });
          return true;
        }}
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
            write({ rotation: degrees });
            return true;
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField key={keyed('x')} label={t('selection.x')} text={lengthText(ends.map((p) => p.x))} mixed={lengthText(ends.map((p) => p.x)) === ''} onCommit={length((m) => ({ startX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={lengthText(ends.map((p) => p.y))} mixed={lengthText(ends.map((p) => p.y)) === ''} onCommit={length((m) => ({ startY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.startNote')}</p>
    </div>
  );
}
