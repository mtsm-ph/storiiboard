import { useId } from 'react';
import { getLocale, isLocaleId, LOCALES, setLocale, t } from '../../core/i18n';
import { isMeasurementSystem, measurementOf, unitsOfSystem } from '../../core/model/measurementSystem';
import {
  isDirectionsApp,
  isPlanUnitsChoice,
  isWeatherUnitsChoice,
  isWeekStartChoice,
  saveSettings,
  type DirectionsApp,
  type PlanUnitsChoice,
  type WeatherUnitsChoice,
  type WeekStartChoice,
} from '../../core/storage/settings';
import type { LocaleId } from '../../core/i18n';
import { setDirectionsApp, useDirectionsApp } from '../directionsApp';
import { setWeekStartChoice, useWeekStartChoice } from '../weekStart';
import { setWeatherUnitsChoice, useWeatherUnitsChoice } from '../weatherUnits';
import { setPlanUnitsChoice, usePlanUnitsChoice } from '../planUnits';
import { setTrackpadMode, useTrackpadMode } from '../trackpadMode';
import { setDraft, useDraft } from '../settings/drafts';
import { Select, Toggle } from '../../ui/fields';
import { CompanyProfilesPanel } from '../company/CompanyProfilesPanel';

// Settings → App: what belongs to the person rather than the project. The language changes every screen, and the next
// export; a project opened on another computer shows there in that person's own language. And the company profiles
// saved on this computer, to attach to projects (3.2). And where the Calendar's week starts (3.17): as this computer's
// region says, or Sunday or Monday, in every language. And the Measurement system (Kevin, Nov 18), over the forecast's
// units (4.4) and a plan's (6.2a). And trackpad mode (6.5.3), how every plan and board reads the wheel.
// Each of these waits for Apply changes (drafts.ts); the company profiles, a list with buttons of its own, save at once.

const setLanguage = (next: LocaleId) => {
  saveSettings({ language: next });
  setLocale(next);
};

export function AppTile() {
  const [language, draftLanguage] = useDraft<LocaleId>('language', getLocale(), setLanguage);
  const [weekStart, draftWeekStart] = useDraft<WeekStartChoice>('weekStart', useWeekStartChoice(), setWeekStartChoice);
  const appliedWeather = useWeatherUnitsChoice();
  const appliedPlan = usePlanUnitsChoice();
  const [weatherUnits, draftWeather] = useDraft<WeatherUnitsChoice>('weatherUnits', appliedWeather, setWeatherUnitsChoice);
  const [planUnits, draftPlan] = useDraft<PlanUnitsChoice>('planUnits', appliedPlan, setPlanUnitsChoice);
  const [directions, draftDirections] = useDraft<DirectionsApp>('directionsApp', useDirectionsApp(), setDirectionsApp);
  const [trackpad, draftTrackpad] = useDraft<boolean>('trackpadMode', useTrackpadMode(), setTrackpadMode);
  const trackpadNoteId = useId();
  const measurementNoteId = useId();
  const measurement = measurementOf(weatherUnits, planUnits);
  return (
    <>
    <div className="flex max-w-[440px] flex-col gap-2 p-4">
      <Select
        label={t('app.language')}
        value={language}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isLocaleId(next)) draftLanguage(next);
        }}
      >
        {LOCALES.map((locale) => (
          // Each language in its own words, so it can be found whatever the app is in now.
          <option key={locale.id} value={locale.id} lang={locale.tag}>
            {locale.name}
          </option>
        ))}
      </Select>
      <p className="text-[12px] text-text-muted">{t('app.languageNote')}</p>
      <Select
        label={t('app.weekStart')}
        value={weekStart}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isWeekStartChoice(next)) draftWeekStart(next);
        }}
      >
        <option value="region">{t('app.weekStart.region')}</option>
        <option value="sunday">{t('app.weekStart.sunday')}</option>
        <option value="monday">{t('app.weekStart.monday')}</option>
      </Select>
      {/* One choice over the two beneath it (Kevin, Nov 18), never stored itself: it reads Mixed when they disagree. */}
      <div className="mt-2 flex flex-col gap-2" data-measurement={measurement}>
        <Select
          label={t('app.measurement')}
          value={measurement}
          aria-describedby={measurementNoteId}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (!isMeasurementSystem(next)) return;
            const units = unitsOfSystem(next);
            setDraft('weatherUnits', units.weatherUnits, appliedWeather, setWeatherUnitsChoice);
            setDraft('planUnits', units.planUnits, appliedPlan, setPlanUnitsChoice);
          }}
        >
          <option value="region">{t('app.measurement.region')}</option>
          <option value="metric">{t('app.measurement.metric')}</option>
          <option value="us">{t('app.measurement.us')}</option>
          {/* Shown only as a reading, never picked: the two settings beneath say what it is. */}
          {measurement === 'mixed' && (
            <option value="mixed" disabled>
              {t('app.measurement.mixed')}
            </option>
          )}
        </Select>
        <p id={measurementNoteId} className="text-[12px] text-text-muted">
          {measurement === 'mixed'
            ? t('app.measurement.mixedNote', { plan: t(`app.planUnits.${planUnits}`), weather: t(`app.weatherUnits.${weatherUnits}`) })
            : t('app.measurement.note')}
        </p>
        <div className="flex flex-col gap-2 border-l-[1.5px] border-text pl-3">
          <Select
            label={t('app.planUnits')}
            value={planUnits}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (isPlanUnitsChoice(next)) draftPlan(next);
            }}
          >
            <option value="region">{t('app.planUnits.region')}</option>
            <option value="metres">{t('app.planUnits.metres')}</option>
            <option value="feet">{t('app.planUnits.feet')}</option>
          </Select>
          <Select
            label={t('app.weatherUnits')}
            value={weatherUnits}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (isWeatherUnitsChoice(next)) draftWeather(next);
            }}
          >
            <option value="region">{t('app.weatherUnits.region')}</option>
            <option value="metric">{t('app.weatherUnits.metric')}</option>
            <option value="us">{t('app.weatherUnits.us')}</option>
          </Select>
          <p className="text-[12px] text-text-muted">{t('app.weatherUnitsNote')}</p>
        </div>
      </div>
      <Select
        label={t('app.directionsApp')}
        value={directions}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isDirectionsApp(next)) draftDirections(next);
        }}
      >
        <option value="google">{t('app.directionsApp.google')}</option>
        <option value="apple">{t('app.directionsApp.apple')}</option>
        <option value="osm">{t('app.directionsApp.osm')}</option>
      </Select>
      <p className="text-[12px] text-text-muted">{t('app.directionsAppNote')}</p>
      {/* The same choice each plan and board has by its zoom (6.5.3): there it applies at once, here with Apply. */}
      <div className="mt-2">
        <Toggle label={t('app.trackpadMode')} checked={trackpad} onChange={draftTrackpad} describedBy={trackpadNoteId} />
      </div>
      <p id={trackpadNoteId} className="text-[12px] text-text-muted">
        {t('app.trackpadModeNote')}
      </p>
    </div>
    <CompanyProfilesPanel />
    </>
  );
}
