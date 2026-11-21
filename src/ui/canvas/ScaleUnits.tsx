import { t } from '../../core/i18n';
import type { PlanUnit } from '../../core/model/length';
import { cx } from '../cx';

// The m | ft switch by a plan's scale bar (Kevin, Nov 18): two pressed-or-not buttons in the zoom's box, the unit in use
// an ink fill, as Paper and Dark's. It only hands the unit picked back: the host keeps it on this computer (Plan units)
// and applies it at once, a view as the Dark view is. Pressing the unit already in use changes nothing, so a computer
// whose Plan units follow its region keeps following it until the other unit is picked.

interface ScaleUnitsProps {
  value: PlanUnit;
  onChange: (unit: PlanUnit) => void;
  /** The canvas's own button classes, so the pair sits in the zoom's box as its other buttons do. */
  button: string;
  pressed: string;
}

export function ScaleUnits({ value, onChange, button, pressed }: ScaleUnitsProps) {
  return (
    <div role="group" aria-label={t('canvas.units.label')} title={t('canvas.units.hint')} data-scale-units={value} className="flex items-center border-x border-text">
      {(['metres', 'feet'] as const).map((unit) => {
        const on = value === unit;
        return (
          <button
            key={unit}
            type="button"
            aria-pressed={on}
            title={t('canvas.units.hint')}
            className={cx(button, 'normal-case', on ? pressed : 'text-text hover:bg-surface-raised')}
            onClick={() => {
              if (!on) onChange(unit);
            }}
          >
            {/* Named by what it shows, then the word in full for a reader: "m (metres)". */}
            {unit === 'metres' ? t('canvas.units.m') : t('canvas.units.ft')}
            <span className="sr-only"> {unit === 'metres' ? t('canvas.units.metres') : t('canvas.units.feet')}</span>
          </button>
        );
      })}
    </div>
  );
}
