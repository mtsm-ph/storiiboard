import type { KeyboardEvent } from 'react';
import { showInfo } from '../../../app/notice';
import { usePlanUnit } from '../../../app/planUnits';
import { useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { formatLength, parseLength, type PlanUnit } from '../../../core/model/length';
import { normalDegrees, planFields, planItemFields, roomTitle, sceneRoom, scenesUsingRoom, wallEnds, type PlanItemFields } from '../../../core/model/plan';
import { TextField } from '../../../ui/fields';
import { changeWalls, renameRoom } from './planActions';
import { viewKey, type WallPatch } from './planItems';
import { usePlan } from './planStore';
import { useLiveView } from './PlanTile';

// The Selection tile (6.2a), in the Setup workspace: the selected plan item's fields as it reads them, each typed and
// each one edit when it's left (one ⌘Z), lengths in the unit the screen shows and read in any form (src/core/model/
// length.ts); one that can't be read snaps back and says so, and nothing is saved. Several selected: the fields they
// share, and a change goes to each. Nothing selected: the room, its name, and how many scenes are set in it.

const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') event.currentTarget.blur();
};

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
  /** Reads what was typed: true when it was taken (and written), false to snap back with `refused`. */
  onCommit: (typed: string) => boolean;
  refused: string;
  name?: string;
}

function TypedField({ label, text, mixed = false, onCommit, refused, name }: TypedFieldProps) {
  return (
    <TextField
      // Keyed by the value, so an undo shows in the field it changed.
      key={`${label}:${text}`}
      label={label}
      mono
      name={name}
      autoComplete="off"
      defaultValue={text}
      placeholder={mixed ? t('plan.field.mixed') : undefined}
      onBlur={(event) => {
        const input = event.currentTarget;
        if (input.value.trim() === text) return;
        if (!onCommit(input.value)) {
          input.value = text;
          showInfo(refused);
        }
      }}
      onKeyDown={blurOnEnter}
    />
  );
}

/** "90°": a rotation in whole hundredths, as a technical value. */
const degreesText = (degrees: number): string => t('plan.degrees', { value: String(Math.round(degrees * 100) / 100) });
const readDegrees = (typed: string): number | null => {
  const text = typed.trim().replace(/°$/, '').replace(',', '.').trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? normalDegrees(Number(text)) : null;
};

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
      <TextField
        key={`room:${fields?.name ?? ''}`}
        label={t('selection.roomName')}
        autoComplete="off"
        defaultValue={roomTitle(fields)}
        onBlur={(event) => {
          const typed = event.currentTarget.value.trim();
          if (typed === roomTitle(fields)) return;
          if (typed === '') {
            event.currentTarget.value = roomTitle(fields);
            return;
          }
          void renameRoom(room.id, typed);
        }}
        onKeyDown={blurOnEnter}
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
  return (
    <div className="flex flex-col gap-3 p-3" data-selection-items={ids.join(' ')}>
      <p className="sb-label" data-selection-kind="">
        {ids.length === 1 ? t('plan.item.wall') : tn('selection.walls', ids.length)}
      </p>
      <TextField
        key={`name:${names ?? ''}`}
        label={t('selection.name')}
        autoComplete="off"
        defaultValue={names ?? ''}
        placeholder={names === null ? t('plan.field.mixed') : undefined}
        onBlur={(event) => {
          const typed = event.currentTarget.value.trim();
          if (typed === (names ?? '')) return;
          write({ name: typed });
        }}
        onKeyDown={blurOnEnter}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField label={t('selection.length')} text={lengthText(walls.map((w) => w.width))} mixed={lengthText(walls.map((w) => w.width)) === ''} onCommit={length((m) => ({ length: m }))} refused={refused} />
        <TypedField label={t('selection.thickness')} text={lengthText(walls.map((w) => w.height))} mixed={lengthText(walls.map((w) => w.height)) === ''} onCommit={length((m) => ({ thickness: m }))} refused={refused} />
        <TypedField
          label={t('selection.height')}
          text={shared(heights) ?? ''}
          mixed={shared(heights) === null}
          onCommit={length((m) => ({ heightM: m }), { empty: { heightM: null } })}
          refused={refused}
        />
        <TypedField
          label={t('selection.rotation')}
          text={rotations ?? ''}
          mixed={rotations === null}
          onCommit={(typed) => {
            const degrees = readDegrees(typed);
            if (degrees === null) return false;
            write({ rotation: degrees });
            return true;
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField label={t('selection.x')} text={lengthText(ends.map((p) => p.x))} mixed={lengthText(ends.map((p) => p.x)) === ''} onCommit={length((m) => ({ startX: m }), { signed: true })} refused={refused} />
        <TypedField label={t('selection.y')} text={lengthText(ends.map((p) => p.y))} mixed={lengthText(ends.map((p) => p.y)) === ''} onCommit={length((m) => ({ startY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.startNote')}</p>
    </div>
  );
}
