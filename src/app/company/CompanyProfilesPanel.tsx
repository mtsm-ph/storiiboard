import { useId, useState } from 'react';
import { t } from '../../core/i18n';
import { COMPANY_FIELDS, MAX_COMPANIES, type CompanyField, type CompanyProfile } from '../../core/model/company';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { choosePictures } from '../pictures';
import { addCompany, logoFromPicture, removeCompany, saveCompany, useCompanies } from './companies';

// Company profiles in Settings → App (3.2): production companies saved once on this computer, to attach to any
// project from Settings → Project. They're the person's, not a project's, so changing one is no edit and doesn't undo;
// a project keeps its copy until Update from profile.

export const COMPANY_FIELD_LABEL: Readonly<Record<CompanyField, () => string>> = {
  name: () => t('company.name'),
  address: () => t('company.address'),
  phone: () => t('company.phone'),
  email: () => t('company.email'),
  website: () => t('company.website'),
};

const FIELD_TYPE: Partial<Record<CompanyField, string>> = { phone: 'tel', email: 'email', website: 'url' };

export function CompanyProfilesPanel() {
  const companies = useCompanies();
  const headingId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const said = (ok: boolean, why = t('company.notSaved')) => {
    setProblem(ok ? null : why);
  };
  return (
    <section aria-labelledby={headingId} className="flex max-w-[640px] flex-col gap-3 border-t border-text p-4">
      <h3 id={headingId} className="sb-label">
        {t('company.profiles')}
      </h3>
      <p className="text-[12px] text-text-muted">{t('company.profilesNote')}</p>
      {companies.length === 0 && <p className="text-[13px]">{t('company.none')}</p>}
      <ul className="flex flex-col gap-3" aria-label={t('company.profiles')}>
        {companies.map((company, index) => (
          <li key={company.id}>
            <CompanyEditor company={company} index={index} onSaved={said} />
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {problem}
        </p>
      )}
      <Button
        className="self-start"
        disabled={companies.length >= MAX_COMPANIES}
        onClick={() => {
          said(addCompany() !== null);
        }}
      >
        {t('company.add')}
      </Button>
    </section>
  );
}

function CompanyEditor({ company, index, onSaved }: { company: CompanyProfile; index: number; onSaved: (ok: boolean, why?: string) => void }) {
  const groupId = useId();
  const title = company.name || t('company.untitled', { n: index + 1 });
  return (
    <fieldset aria-labelledby={groupId} className="flex flex-col gap-3 border border-text p-3">
      <legend id={groupId} className="sb-label px-1">
        {title}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        {COMPANY_FIELDS.map((field) => (
          <TextField
            key={`${field}:${company[field]}`}
            label={COMPANY_FIELD_LABEL[field]()}
            type={FIELD_TYPE[field]}
            defaultValue={company[field]}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              if (value !== company[field]) onSaved(saveCompany({ ...company, [field]: value }));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {company.logo ? (
          <img src={company.logo} alt={t('company.logoOf', { name: title })} className="h-[40px] max-w-[160px] border border-border object-contain" />
        ) : (
          <span className="text-[12px] text-text-muted">{t('company.noLogo')}</span>
        )}
        <Button
          onClick={() => {
            void (async () => {
              const [picked] = await choosePictures(false);
              if (!picked) return;
              const logo = await logoFromPicture(await picked.read());
              if (logo === null) {
                onSaved(false, t('company.logoUnreadable', { name: picked.name }));
                return;
              }
              onSaved(saveCompany({ ...company, logo }));
            })();
          }}
        >
          {company.logo ? t('company.replaceLogo') : t('company.chooseLogo')}
        </Button>
        {company.logo && (
          <Button
            onClick={() => {
              onSaved(saveCompany({ ...company, logo: null }));
            }}
          >
            {t('company.removeLogo')}
          </Button>
        )}
        <Button
          className="ml-auto"
          onClick={() => {
            onSaved(removeCompany(company.id));
          }}
        >
          {t('company.remove', { name: title })}
        </Button>
      </div>
    </fieldset>
  );
}
