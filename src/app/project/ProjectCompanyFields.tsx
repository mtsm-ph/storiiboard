import { useId, useState } from 'react';
import { localizeError, t } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import { COMPANY_FIELDS, profileChanged, projectCompany, type CompanyProfile } from '../../core/model/company';
import type { SbdRecord } from '../../core/model/record';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { logoFile, useCompanies } from '../company/companies';
import { attachCompany, detachCompany } from '../company/companyEdits';
import { COMPANY_FIELD_LABEL } from '../company/CompanyProfilesPanel';
import { openSettings } from '../settings/SettingsWindow';
import { useProject } from '../projectStore';

// The production company in Settings → Project (3.2): one of this computer's profiles (Settings → App) attached to the
// project, which copies its details and logo into the file. The copy is shown here as the file holds it; Update from
// profile copies the profile again when it has changed, and Detach takes it off. Each is one edit, so ⌘Z takes it back.

export function ProjectCompanyFields({ record }: { record: SbdRecord }) {
  const companies = useCompanies();
  const applyWith = useProject((s) => s.applyWith);
  const project = useProject((s) => s.project);
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const copy = projectCompany(record.props);
  const profile = copy ? (companies.find((c) => c.id === copy.profileId) ?? null) : null;

  const attach = async (chosen: CompanyProfile) => {
    if (!project || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const logo = chosen.logo ? await prepareImage(await logoFile(chosen.logo, `${chosen.name || 'Company'} logo.png`)) : null;
      // From the records at the edit's turn, so it lands over whatever came before it.
      await applyWith((now) => attachCompany(now, record.id, chosen, logo, project.file.path));
    } catch (error) {
      setProblem(localizeError(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex max-w-[640px] flex-col gap-3 border-t border-text p-4">
      <h3 id={headingId} className="sb-label">
        {t('company.production')}
      </h3>
      <Select
        label={t('company.attached')}
        value={copy?.profileId ?? ''}
        disabled={busy}
        onChange={(event) => {
          const id = event.currentTarget.value;
          if (id === '') {
            void applyWith((now) => ({ changes: detachCompany(now, record.id) }));
            return;
          }
          const chosen = companies.find((c) => c.id === id);
          if (chosen) void attach(chosen);
        }}
      >
        <option value="">{t('company.noneAttached')}</option>
        {/* A copy from a profile this computer doesn't have (a file from someone else) still shows by name. */}
        {copy && !profile && <option value={copy.profileId}>{t('company.copyOnly', { name: copy.name || t('company.unnamed') })}</option>}
        {companies.map((c, i) => (
          <option key={c.id} value={c.id}>
            {c.name || t('company.untitled', { n: i + 1 })}
          </option>
        ))}
      </Select>
      {companies.length === 0 && (
        <p className="text-[12px] text-text-muted">
          {t('company.noProfiles')}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              openSettings('app');
            }}
          >
            {t('company.openApp')}
          </button>
        </p>
      )}
      {copy && (
        <div className="flex flex-col gap-2" data-project-company="">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
            {COMPANY_FIELDS.filter((field) => copy[field] !== '').map((field) => (
              <div key={field} className="contents">
                <dt className="sb-label self-center">{COMPANY_FIELD_LABEL[field]()}</dt>
                <dd>{copy[field]}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {profile && profileChanged(copy, profile) && (
              <Button
                disabled={busy}
                onClick={() => {
                  void attach(profile);
                }}
              >
                {t('company.update')}
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                void applyWith((now) => ({ changes: detachCompany(now, record.id) }));
              }}
            >
              {t('company.detach')}
            </Button>
          </div>
          {profile && !profileChanged(copy, profile) && <p className="text-[12px] text-text-muted">{t('company.upToDate')}</p>}
        </div>
      )}
      {problem && (
        <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {problem}
        </p>
      )}
    </section>
  );
}
