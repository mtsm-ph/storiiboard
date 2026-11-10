import { useWeatherUnits } from '../../app/weatherUnits';
import { t } from '../../core/i18n';
import type { SheetLocation } from '../../core/model/callsheet';
import { emergencyText } from '../../core/model/emergencyNumbers';
import { distanceText } from '../../core/net/hospitals';

// One location's safety box on the call sheet (4.5): the number to call for an ambulance in its country, large and in
// mono, and the nearest hospital kept on the location. It sits inside each location's block, since the number and the
// hospital belong to that place and a day can shoot at several. The sheet's own safety notes (4.1) stay in Notes.
// A hospital found by the OpenStreetMap search is credited to it; one typed by hand is not.

export function SafetyBox({ location }: { location: SheetLocation }) {
  const units = useWeatherUnits();
  const { numbers, hospital } = location.safety;
  return (
    <div data-safety="" className="flex flex-col gap-1 border border-border p-2">
      <p className="sb-label">{t('callSheet.safetyBox')}</p>
      {numbers.length === 0 ? (
        <p data-emergency-number="">{t('emergency.checkLocally')}</p>
      ) : (
        <p data-emergency-number="" className="font-mono text-[22px] font-bold">
          {emergencyText(numbers)}
        </p>
      )}
      {hospital === null ? (
        <p data-hospital-none="" className="text-text-muted">
          {t('callSheet.noHospital')}
        </p>
      ) : (
        <div data-hospital="" className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="sb-label">{t('callSheet.nearestHospital')}</span>
            {hospital.name.trim() !== '' && (
              <span data-user-text="" className="font-semibold">
                {hospital.name}
              </span>
            )}
            {hospital.distanceKm !== null && (
              <span data-hospital-distance="" className="font-mono">
                {distanceText(hospital.distanceKm, units)}
              </span>
            )}
          </p>
          {hospital.address.trim() !== '' && <p data-user-text="">{hospital.address}</p>}
          {hospital.phone.trim() !== '' && (
            <p data-user-text="" className="font-mono">
              {hospital.phone}
            </p>
          )}
          {hospital.emergency ? (
            <p data-hospital-emergency="">{t('hospital.emergencyRoom')}</p>
          ) : (
            // Truffle on paper; in dark mode the page's text (it falls below AA there); the ▲ is the second cue.
            <p data-hospital-check="" className="text-warning dark:text-text">
              <span aria-hidden="true">▲ </span>
              {t('hospital.checkEmergencyRoom')}
            </p>
          )}
          {hospital.fromSearch && (
            <p data-hospital-credit="" className="text-[11px] text-text-muted">
              {t('callSheet.osmCredit')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
