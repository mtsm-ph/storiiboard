import { useEffect, useId, useRef, useState } from 'react';
import { localizeError, t } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import { mediaFields } from '../../core/media/store';
import { imageUrl } from '../../core/media/urls';
import { COMPANY_FIELDS, profileChanged, projectCompany, type CompanyProfile } from '../../core/model/company';
import type { SbdRecord } from '../../core/model/record';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { logoFile, useCompanies } from '../company/companies';
import { attachCompany, companyLogo, detachCompany, needsLogo } from '../company/companyEdits';
import { COMPANY_FIELD_LABEL } from '../company/CompanyProfilesPanel';
import { openSettings } from '../settings/settingsStore';
import { useProject } from '../projectStore';

// The production company in Settings → Project (3.2): one of this computer's profiles (Settings → App) attached to the
// project, which copies its details and logo into the file. The menu only picks a profile; Attach copies it, so moving
// through the menu with the arrow keys changes nothing. The copy is shown as the file holds it, logo included; Update
// from profile copies the profile again when it has changed, and Detach takes it off. Each is one edit, one ⌘Z.

/** The menu's value for the project's own copy when this computer has no such profile. */
const COPY_ONLY = 'copy-only';

export function ProjectCompanyFields({ record }: { record: SbdRecord }) {
  const companies = useCompanies();
  const applyWith = useProject((s) => s.applyWith);
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const written = useProject((s) => s.picturesWritten);
  const headingId = useId();
  const section = useRef<HTMLElement>(null);
  // A ref, not state: a second click can land before the first re-renders.
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const copy = projectCompany(record.props);
  const profile = copy ? (companies.find((c) => c.id === copy.profileId) ?? null) : null;
  const attachedValue = copy ? (profile ? profile.id : COPY_ONLY) : '';
  // What the menu shows: the person's pick until it's attached or changed again, else what's attached.
  const [picked, setPicked] = useState<string | null>(null);
  // An undo or redo that changes what's attached leaves the menu showing that, not an older pick.
  const [pickedFor, setPickedFor] = useState(attachedValue);
  if (pickedFor !== attachedValue) {
    setPickedFor(attachedValue);
    setPicked(null);
  }
  const menuId = useId();
  const shown = picked ?? attachedValue;
  const choice = companies.find((c) => c.id === shown) ?? null;

  // The project's own copy of the logo, as the file holds it.
  const logo = copy ? companyLogo(records, record.id, copy.logoId) : null;
  const sha256 = logo ? (mediaFields(logo.props)?.sha256 ?? null) : null;
  const [logoUrl, setLogoUrl] = useState<{ sha256: string; url: string | null } | null>(null);
  const file = project?.file ?? null;
  useEffect(() => {
    if (!file || !sha256) return;
    let live = true;
    void imageUrl(file, sha256).then((url) => {
      if (live) setLogoUrl({ sha256, url });
    });
    return () => {
      live = false;
    };
  }, [file, sha256, written]);
  const shownLogo = sha256 && logoUrl?.sha256 === sha256 ? logoUrl : null;
  // A copy whose logo isn't in the project any more (a hand-edited file, another tool): Update puts it back.
  const changed = copy !== null && profile !== null && (profileChanged(copy, profile) || (copy.logoId !== null && logo === null));

  const run = async (work: () => Promise<unknown>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await work();
      setPicked(null);
      // The button pressed goes once its work is done (Attach once attached, Detach with the copy): focus to the menu,
      // unless the person has moved on to something else meanwhile.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active === null || active === document.body || section.current?.contains(active)) document.getElementById(menuId)?.focus();
      });
    } catch (error) {
      setProblem(localizeError(error instanceof Error ? error.message : String(error)));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const attach = (chosen: CompanyProfile) =>
    run(async () => {
      if (!project) return;
      // The logo made into a picture only when the project doesn't have this very one already.
      const made =
        chosen.logo && needsLogo(records, record.id, chosen) ? await prepareImage(await logoFile(chosen.logo, 'logo.png')) : null;
      // From the records at the edit's turn, so it lands over whatever came before it.
      await applyWith((now) => attachCompany(now, record.id, chosen, made, project.file.path));
    });
  const detach = () => run(() => applyWith((now) => ({ changes: detachCompany(now, record.id) })));

  return (
    <section ref={section} aria-labelledby={headingId} className="flex max-w-[640px] flex-col gap-3 border-t border-text p-4">
      <h3 id={headingId} className="sb-label">
        {t('company.production')}
      </h3>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            id={menuId}
            label={t('company.attached')}
            value={shown}
            onChange={(event) => {
              setPicked(event.currentTarget.value);
            }}
          >
            <option value="">{t('company.noneAttached')}</option>
            {/* A copy from a profile this computer doesn't have (a file from someone else) still shows by name. */}
            {copy && !profile && <option value={COPY_ONLY}>{t('company.copyOnly', { name: copy.name || t('company.unnamed') })}</option>}
            {companies.map((c, i) => (
              <option key={c.id} value={c.id}>
                {c.name || t('company.untitled', { n: i + 1 })}
              </option>
            ))}
          </Select>
        </div>
        {/* Not disabled while it works: focus stays on it. */}
        {choice && shown !== attachedValue && (
          <Button
            variant="primary"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) void attach(choice);
            }}
          >
            {copy ? t('company.replace') : t('company.attach')}
          </Button>
        )}
        {copy && shown === '' && (
          <Button
            aria-disabled={busy}
            onClick={() => {
              if (!busy) void detach();
            }}
          >
            {t('company.detach')}
          </Button>
        )}
      </div>
      {companies.length === 0 && (
        <p className="text-[12px] text-text-muted">
          {t('company.noProfiles')}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              openSettings('app');
              // The App tab's own button, so focus goes where the page went.
              requestAnimationFrame(() => {
                document.querySelector<HTMLElement>('[role="tab"][data-settings-tab="app"]')?.focus();
              });
            }}
          >
            {t('company.openApp')}
          </button>
        </p>
      )}
      {copy && (
        <div className="flex flex-col gap-2" data-project-company="">
          {copy.logoId &&
            (shownLogo?.url ? (
              <img src={shownLogo.url} alt={t('company.logoOf', { name: copy.name || t('company.unnamed') })} className="h-[40px] max-w-[160px] self-start border border-border object-contain" />
            ) : logo === null || shownLogo?.url === null ? (
              <p className="text-[12px] text-text-muted">{t('company.logoMissing')}</p>
            ) : null)}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
            {COMPANY_FIELDS.filter((field) => copy[field] !== '').map((field) => (
              <div key={field} className="contents">
                <dt className="sb-label self-center">{COMPANY_FIELD_LABEL[field]()}</dt>
                <dd>{copy[field]}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {profile && changed && (
              <Button
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) void attach(profile);
                }}
              >
                {t('company.update')}
              </Button>
            )}
            <Button
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void detach();
              }}
            >
              {t('company.detach')}
            </Button>
          </div>
          {profile && !changed && <p className="text-[12px] text-text-muted">{t('company.upToDate')}</p>}
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
