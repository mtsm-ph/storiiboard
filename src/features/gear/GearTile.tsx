import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import { bodyFields, GEAR_KIND_LABEL, GEAR_KINDS, gearKind, lensFields, lensSpec, type GearKind } from '../../core/model/cameraGear';
import { DEPARTMENT_LABELS, DEPARTMENTS } from '../../core/model/department';
import { CURRENCIES, currencyDigits, GEAR_SOURCE_LABEL, GEAR_SOURCES, moneyLabel, projectCurrency, projectGear, type GearFields } from '../../core/model/gear';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Select, TextArea, TextField } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { BodyFieldsEditor, LensFieldsEditor } from './BodyLensFields';
import {
  currencyChange,
  gearDepartmentChange,
  gearKindChange,
  gearQuantityChange,
  gearRateChange,
  gearSourceChange,
  gearTextChange,
  newGearItem,
  trashGearItem,
} from './gearEdits';

// The Gear tile (3.9a), in the Production workspace: the project's gear catalogue, each item named once with how many,
// whose it is (owned, or a rental house's), its day rate and its department. Shoot days and frames pick from it (3.9b).
// The project's currency, for every price, sits at the foot of the list. Each field is one edit when it's left, so one
// ⌘Z; Delete sends an item to the Trash. Narrow (Production gives it a column), the list sits above the item.
// An item is gear, a camera body or a lens (6.1): a body and a lens have fields of their own (BodyLensFields.tsx), and
// count in day lists, checks and totals as any gear does.

type Records = Readonly<Record<string, SbdRecord>>;
type GearSourceChoice = (typeof GEAR_SOURCES)[number] | '';

/** Narrower than this, the list goes above the item rather than beside it. */
const SIDE_BY_SIDE = 520;

export function GearTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [chosen, setChosen] = useState<string | null>(null);
  const listId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const making = useRef(false);
  const [width, setWidth] = useState(0);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const measure = useCallback((element: HTMLDivElement | null) => {
    setBox(element);
    if (element) setWidth(element.getBoundingClientRect().width);
  }, []);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [box]);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('gear.noProject')}</p>;
  const projectId = project.projectId;
  const all = projectGear(records, projectId);
  const selected = all.find((g) => g.record.id === chosen) ?? all[0] ?? null;
  const currency = projectCurrency(records[projectId]?.props);
  const wide = width >= SIDE_BY_SIDE;

  const edit = (build: (now: Records) => Change[]) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

  return (
    <div ref={measure} className={cx('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
      <div className={cx('flex shrink-0 flex-col border-border', wide ? 'w-[220px] border-r' : 'max-h-[40%] border-b')}>
        <div className="flex items-center gap-2 border-b border-border p-2">
          <p className="sb-label flex-1 font-mono">{tn('gear.count', all.length)}</p>
          <Button
            ref={newButton}
            onClick={() => {
              if (making.current) return;
              making.current = true;
              const id = crypto.randomUUID();
              void edit((now) => [newGearItem(now, projectId, id)])
                .then((made) => {
                  if (!made) return;
                  setChosen(id);
                  requestAnimationFrame(() => nameField.current?.focus());
                })
                .finally(() => {
                  making.current = false;
                });
            }}
          >
            {t('gear.new')}
          </Button>
        </div>
        {all.length === 0 ? (
          <p className="p-3 text-[13px] text-text-muted">{t('gear.none')}</p>
        ) : (
          <ul id={listId} aria-label={t('gear.list')} className="min-h-0 flex-1 overflow-y-auto">
            {all.map(({ record, fields }) => {
              const current = record.id === selected?.record.id;
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    aria-current={current || undefined}
                    data-gear-id={record.id}
                    onClick={() => {
                      setChosen(record.id);
                    }}
                    // On the ink fill, the focus ring is paper (DESIGN.md: never ink on ink).
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left focus-visible:-outline-offset-2',
                      current ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span className="max-w-full truncate text-[13px] font-semibold">{fields.name || t('gear.unnamed')}</span>
                    <span className="sb-label">
                      <span className="font-mono">×{fields.quantity}</span>
                      <KindNote props={record.props} />
                      {fields.source && ` · ${GEAR_SOURCE_LABEL[fields.source]}`}
                      {fields.department && ` · ${DEPARTMENT_LABELS[fields.department]}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border p-2">
          <Select
            label={t('gear.currency')}
            mono
            value={currency}
            onChange={(event) => {
              const code = event.currentTarget.value;
              void edit((now) => currencyChange(now, projectId, code));
            }}
          >
            {/* One set before this list (by a newer version, say) stays offered. */}
            {[...new Set<string>([...CURRENCIES, currency])].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {selected && (
        <GearEditor
          key={selected.record.id}
          id={selected.record.id}
          projectId={projectId}
          records={records}
          props={selected.record.props}
          fields={selected.fields}
          currency={currency}
          nameField={nameField}
          edit={edit}
          onDelete={() => {
            const name = selected.fields.name || t('gear.unnamed');
            void edit((now) => trashGearItem(now, selected.record.id)).then((done) => {
              if (!done) return;
              // A note about this step: an undo clears it.
              showInfo(t('gear.trashed', { name }), { step: true });
              requestAnimationFrame(() => {
                const row = document.getElementById(listId)?.querySelector<HTMLElement>('button');
                (row ?? newButton.current)?.focus();
              });
            });
          }}
        />
      )}
    </div>
  );
}

/** A body's letter or a lens's range, after its quantity in the list: "· A cam", "· 24–70 mm 2×". */
function KindNote({ props }: { props: SbdRecord['props'] }) {
  const kind = gearKind(props);
  if (kind === 'camera_body') {
    const letter = bodyFields(props).letter;
    return (
      <>
        {` · ${GEAR_KIND_LABEL.camera_body}`}
        {letter && (
          <>
            {' · '}
            <span className="font-mono">{t('gear.cameraLetterOption', { letter })}</span>
          </>
        )}
      </>
    );
  }
  if (kind === 'lens') {
    return (
      <>
        {' · '}
        <span className="font-mono">{lensSpec(lensFields(props))}</span>
      </>
    );
  }
  return null;
}

interface GearEditorProps {
  id: string;
  projectId: string;
  records: Records;
  /** As stored: a field holding what this version can't read is shown read-only, never written over. */
  props: SbdRecord['props'];
  fields: GearFields;
  currency: string;
  nameField: React.RefObject<HTMLInputElement | null>;
  edit: (build: (now: Records) => Change[]) => Promise<boolean>;
  onDelete: () => void;
}

function GearEditor({ id, projectId, records, props, fields, currency, nameField, edit, onDelete }: GearEditorProps) {
  const kind = gearKind(props);
  const headingId = useId();
  const lockedId = useId();
  const digits = currencyDigits(currency);
  const rateText = fields.dayRate === null ? '' : String(fields.dayRate);
  // Stored, but not as this version reads it (a newer one's): the field shows what it reads and can't be changed here.
  const unreadable = (prop: string) => props[prop] !== undefined && typeof props[prop] !== typeof '';
  // Read-only says why, to everyone: in its title, and read after the field's name.
  const lockedProps = { readOnly: true, title: t('gear.unreadable'), 'aria-describedby': lockedId };
  const text = (prop: 'name' | 'owner' | 'notes', label: string) => {
    const value = fields[prop];
    const locked = unreadable(prop) ? lockedProps : {};
    const onBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Untouched, nothing is written: a name stored with a space at its end stays as it was.
      if (event.currentTarget.value === value) return;
      const next = prop === 'notes' ? event.currentTarget.value : event.currentTarget.value.trim();
      if (next !== value) void edit((now) => gearTextChange(now, id, prop, next));
    };
    // Keyed by the value, so an undo shows in the field it changed and the others keep focus.
    return prop === 'notes' ? (
      <TextArea key={`${prop}:${value}`} label={label} defaultValue={value} onBlur={onBlur} {...locked} />
    ) : (
      <TextField
        key={`${prop}:${value}`}
        label={label}
        defaultValue={value}
        onBlur={onBlur}
        {...locked}
        autoComplete="off"
        {...(prop === 'name' ? { ref: nameField } : {})}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-gear-editor="">
      <h3 id={headingId} className="sb-label">
        {fields.name || t('gear.unnamed')}
      </h3>
      {text('name', t('gear.name'))}
      <SegmentedControl<GearKind>
        label={t('gear.kind')}
        options={GEAR_KINDS.map((value) => ({ value, label: GEAR_KIND_LABEL[value] }))}
        value={kind}
        onChange={(next) => {
          void edit((now) => gearKindChange(now, id, next));
        }}
      />
      {kind === 'camera_body' && <BodyFieldsEditor id={id} projectId={projectId} records={records} props={props} edit={edit} />}
      {kind === 'lens' && <LensFieldsEditor key={id} id={id} props={props} edit={edit} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
        <Select
          label={t('gear.department')}
          value={fields.department ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            void edit((now) => gearDepartmentChange(now, id, value === '' ? null : value));
          }}
        >
          <option value="">{t('gear.noDepartment')}</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </Select>
        <TextField
          key={`quantity:${String(fields.quantity)}`}
          label={t('gear.quantity')}
          type="number"
          mono
          min={1}
          max={999}
          defaultValue={String(fields.quantity)}
          {...(unreadable('quantity') && typeof props.quantity !== 'number' ? lockedProps : {})}
          onBlur={(event) => {
            // Untouched, nothing is written: a value read as 1 (one stored out of range) stays as it was.
            if (event.currentTarget.value === String(fields.quantity)) return;
            const value = Number(event.currentTarget.value);
            if (Number.isInteger(value) && value >= 1 && value <= 999) void edit((now) => gearQuantityChange(now, id, value));
            else {
              event.currentTarget.value = String(fields.quantity);
              showInfo(t('gear.quantityRefused'));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      <SegmentedControl<GearSourceChoice>
        label={t('gear.source')}
        options={GEAR_SOURCES.map((value) => ({ value, label: GEAR_SOURCE_LABEL[value] }))}
        // One this version doesn't know shows neither, until the person picks one.
        value={fields.source ?? ''}
        onChange={(source) => {
          if (source !== '') void edit((now) => gearSourceChange(now, id, source));
        }}
      />
      {/* Named for what it is: the owner, or the rental house it comes from. */}
      {text('owner', fields.source === 'rental' ? t('gear.rentalHouse') : t('gear.owner'))}
      <TextField
        key={`rate:${String(fields.dayRate)}`}
        label={t('gear.dayRate', { currency })}
        type="number"
        mono
        min={0}
        step={digits === 0 ? '1' : String(1 / 10 ** digits)}
        defaultValue={rateText}
        {...(unreadable('day_rate') && typeof props.day_rate !== 'number' ? lockedProps : {})}
        onBlur={(event) => {
          const raw = event.currentTarget.value.trim();
          // Text the field can't read as a number reads as empty: refused, never taken for an untouched field.
          const bad = event.currentTarget.validity.badInput;
          // Untouched, nothing is written: a rate stored as this version can't read stays as it was.
          if (!bad && raw === rateText) return;
          const rate = raw === '' ? null : Number(raw);
          if (bad || (rate !== null && (!Number.isFinite(rate) || rate < 0))) {
            event.currentTarget.value = rateText;
            showInfo(t('gear.rateRefused'));
            return;
          }
          void edit((now) => gearRateChange(now, id, rate, digits));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {fields.dayRate !== null && (
        <p className="font-mono text-[12px]">
          {t('gear.rateLine', { rate: moneyLabel(fields.dayRate, currency), total: moneyLabel(fields.dayRate * fields.quantity, currency), quantity: fields.quantity })}
        </p>
      )}
      {text('notes', t('gear.notes'))}
      <p id={lockedId} hidden>
        {t('gear.unreadable')}
      </p>
      <div>
        <Button variant="warning" onClick={onDelete}>
          {t('gear.delete')}
        </Button>
      </div>
    </section>
  );
}
