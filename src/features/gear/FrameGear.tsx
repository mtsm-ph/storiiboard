import { list, t } from '../../core/i18n';
import { gearNotOnDay } from '../../core/checks';
import { gearFields, gearIdsOf, projectGear } from '../../core/model/gear';
import type { SbdRecord } from '../../core/model/record';
import { dayLabel, projectShootDays } from '../../core/model/shootDay';
import { Button } from '../../ui/Button';
import { GearPicker } from './GearPicker';

// The gear a frame needs (3.9b), in the Inspector: picked from the project's catalogue. When the frame is in a shoot
// day whose gear list lacks some of it, the first check says so here, with a way to add it to the day.

interface FrameGearProps {
  records: Readonly<Record<string, SbdRecord>>;
  projectId: string;
  shotId: string;
  onToggle: (gearIds: readonly string[], on: boolean) => void;
  onAddToDay: (dayId: string, gearIds: readonly string[]) => void;
}

export function FrameGear({ records, projectId, shotId, onToggle, onAddToDay }: FrameGearProps) {
  const shot = records[shotId];
  if (!shot) return null;
  const finding = gearNotOnDay(records, projectId).find((f) => f.shotId === shotId);
  const day = finding ? projectShootDays(records, projectId).find((d) => d.record.id === finding.dayId) : undefined;
  const names = (finding?.gearIds ?? []).map((id) => {
    const item = records[id];
    return (item && gearFields(item.props).name) || t('gear.unnamed');
  });
  return (
    <div className="flex flex-col gap-2">
      <GearPicker
        label={t('frameGear.needs')}
        items={projectGear(records, projectId)}
        picked={gearIdsOf(shot.props)}
        missing={finding?.gearIds ?? []}
        onToggle={(id, on) => {
          onToggle([id], on);
        }}
      />
      {finding && day && (
        // Not a live region: it's there from the moment the frame is picked, so it's read as part of the section.
        <div data-gear-warning="" className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="sb-label bg-warning px-[5px] text-paper-fixed">{t('days.notOnList')}</span>
          <span>{t('frameGear.notOnDay', { day: dayLabel(day), items: list(names) })}</span>
          <Button
            onClick={() => {
              onAddToDay(finding.dayId, finding.gearIds);
            }}
          >
            {t('frameGear.addToDay', { day: dayLabel(day) })}
          </Button>
        </div>
      )}
    </div>
  );
}
