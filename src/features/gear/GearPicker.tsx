import { useId } from 'react';
import { t } from '../../core/i18n';
import type { GearFields } from '../../core/model/gear';
import type { SbdRecord } from '../../core/model/record';
import { cx } from '../../ui/cx';

// Gear picked from the project's catalogue (3.9b): for a shoot day's list, or what a frame needs. A pressed button per
// item, as a person's departments are picked; picked is an ink fill, and a frame's item missing from its day's list
// carries the warning's shape and words. The catalogue is the Gear tile's; nothing is made here.

interface GearPickerProps {
  /** Names the group: "Gear on this day", "Gear this frame needs". */
  label: string;
  items: readonly { record: SbdRecord; fields: GearFields }[];
  picked: readonly string[];
  /** Picked items its shoot day's list doesn't have, for a frame. */
  missing?: readonly string[];
  onToggle: (gearId: string, on: boolean) => void;
}

export function GearPicker({ label, items, picked, missing = [], onToggle }: GearPickerProps) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <span id={labelId} className="sb-label">
        {label}
      </span>
      {items.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t('gearPicker.none')}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map(({ record, fields }) => {
            const on = picked.includes(record.id);
            const lacking = on && missing.includes(record.id);
            const name = fields.name || t('gear.unnamed');
            return (
              <button
                key={record.id}
                type="button"
                aria-pressed={on}
                data-gear-pick={record.id}
                onClick={() => {
                  onToggle(record.id, !on);
                }}
                // Picked is an ink fill, as every selection is; the focus ring is paper on it.
                className={cx(
                  'border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold',
                  on ? 'bg-text text-text-inverse focus-visible:-outline-offset-4 focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                )}
              >
                {lacking && (
                  <span aria-hidden="true" className="mr-1">
                    ⚠
                  </span>
                )}
                {name}
                {fields.quantity > 1 && <span className="ml-1 font-mono font-normal">×{fields.quantity}</span>}
                {/* Named by what it shows, the warning read after it. */}
                {lacking && <span className="sr-only">{t('gearPicker.notOnDay')}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
