import { useState } from 'react';
import { getLocale, isLocaleId, LOCALES, setLocale, t } from '../../core/i18n';
import { isDirectionsApp, isPlanUnitsChoice, isWeatherUnitsChoice, isWeekStartChoice, saveSettings } from '../../core/storage/settings';
import { setDirectionsApp, useDirectionsApp } from '../directionsApp';
import { setWeekStartChoice, useWeekStartChoice } from '../weekStart';
import { setWeatherUnitsChoice, useWeatherUnitsChoice } from '../weatherUnits';
import { setPlanUnitsChoice, usePlanUnitsChoice } from '../planUnits';
import { Select } from '../../ui/fields';
import { CompanyProfilesPanel } from '../company/CompanyProfilesPanel';

// Settings → App: what belongs to the person rather than the project. The language changes every screen at once, and
// the next export; a project opened on another computer shows there in that person's own language. And the company
// profiles saved on this computer, to attach to projects (3.2). And where the Calendar's week starts (3.17): as this
// computer's region says, or Sunday or Monday, in every language. And the forecast's units (4.4), and a plan's (6.2a).

export function AppTile() {
  const [language, setLanguage] = useState(getLocale);
  const weekStart = useWeekStartChoice();
  const weatherUnits = useWeatherUnitsChoice();
  const planUnits = usePlanUnitsChoice();
  const directions = useDirectionsApp();
  return (
    <>
    <div className="flex max-w-[440px] flex-col gap-2 p-4">
      <Select
        label={t('app.language')}
        value={language}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!isLocaleId(next)) return;
          saveSettings({ language: next });
          setLanguage(next);
          setLocale(next);
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
          if (isWeekStartChoice(next)) setWeekStartChoice(next);
        }}
      >
        <option value="region">{t('app.weekStart.region')}</option>
        <option value="sunday">{t('app.weekStart.sunday')}</option>
        <option value="monday">{t('app.weekStart.monday')}</option>
      </Select>
      <Select
        label={t('app.weatherUnits')}
        value={weatherUnits}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isWeatherUnitsChoice(next)) setWeatherUnitsChoice(next);
        }}
      >
        <option value="region">{t('app.weatherUnits.region')}</option>
        <option value="metric">{t('app.weatherUnits.metric')}</option>
        <option value="us">{t('app.weatherUnits.us')}</option>
      </Select>
      <Select
        label={t('app.planUnits')}
        value={planUnits}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isPlanUnitsChoice(next)) setPlanUnitsChoice(next);
        }}
      >
        <option value="region">{t('app.planUnits.region')}</option>
        <option value="metres">{t('app.planUnits.metres')}</option>
        <option value="feet">{t('app.planUnits.feet')}</option>
      </Select>
      <Select
        label={t('app.directionsApp')}
        value={directions}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isDirectionsApp(next)) setDirectionsApp(next);
        }}
      >
        <option value="google">{t('app.directionsApp.google')}</option>
        <option value="apple">{t('app.directionsApp.apple')}</option>
        <option value="osm">{t('app.directionsApp.osm')}</option>
      </Select>
      <p className="text-[12px] text-text-muted">{t('app.directionsAppNote')}</p>
    </div>
    <CompanyProfilesPanel />
    </>
  );
}
