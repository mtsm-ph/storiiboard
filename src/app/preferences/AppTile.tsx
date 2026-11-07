import { useState } from 'react';
import { getLocale, isLocaleId, LOCALES, setLocale, t } from '../../core/i18n';
import { saveSettings } from '../../core/storage/settings';
import { Select } from '../../ui/fields';
import { CompanyProfilesPanel } from '../company/CompanyProfilesPanel';

// Settings → App: what belongs to the person rather than the project. The language changes every screen at once, and
// the next export; a project opened on another computer shows there in that person's own language. And the company
// profiles saved on this computer, to attach to projects (3.2).

export function AppTile() {
  const [language, setLanguage] = useState(getLocale);
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
    </div>
    <CompanyProfilesPanel />
    </>
  );
}
