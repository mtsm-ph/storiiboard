import { useEffect, useId, useState } from 'react';
import { t } from '../../core/i18n';
import { COMPANY_FIELDS, MAX_BRAND_COLORS, MAX_BRAND_FONTS, MAX_COMPANIES, type CompanyField, type CompanyProfile } from '../../core/model/company';
import { familiesOf, loadSystemFonts, useFonts } from '../../features/moodboards/fonts';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { choosePictures } from '../pictures';
import { ask } from '../ask';
import { addCompany, logoFromPicture, removeCompany, saveCompany, useCompanies, type CompanyProblem } from './companies';

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
  const system = useFonts((state) => state.system);
  const fontListId = useId();
  useEffect(() => {
    void loadSystemFonts();
  }, []);
  const headingId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  /** Says why the last change wasn't kept, or clears what was said. */
  const said = (problem: CompanyProblem | null, words?: string) => {
    setProblem(problem === null ? null : (words ?? (problem === 'tooManyLogos' ? t('company.tooManyLogos') : t('company.notSaved'))));
  };
  return (
    <section aria-labelledby={headingId} className="flex max-w-[640px] flex-col gap-3 border-t border-text p-4">
      <h3 id={headingId} className="sb-label">
        {t('company.profiles')}
      </h3>
      <p className="text-[12px] text-text-muted">{t('company.profilesNote')}</p>
      {/* The fonts a brand kit can name, listed once for every profile's pickers. */}
      <datalist id={fontListId}>
        {familiesOf(system).map((f) => (
          <option key={f.name} value={f.name} />
        ))}
      </datalist>
      {companies.length === 0 && <p className="text-[13px]">{t('company.none')}</p>}
      <ul className="flex flex-col gap-3" aria-label={t('company.profiles')}>
        {companies.map((company, index) => (
          <li key={company.id}>
            <CompanyEditor company={company} index={index} fontListId={fontListId} onSaved={said} />
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
          said(addCompany());
        }}
      >
        {t('company.add')}
      </Button>
    </section>
  );
}

function CompanyEditor({ company, index, fontListId, onSaved }: { company: CompanyProfile; index: number; fontListId: string; onSaved: (problem: CompanyProblem | null, words?: string) => void }) {
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
      <BrandKit company={company} fontListId={fontListId} onSaved={onSaved} />
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
              const made = await logoFromPicture(await picked.read());
              if (made === 'unreadable') {
                onSaved('notSaved', t('company.logoUnreadable', { name: picked.name }));
                return;
              }
              onSaved(saveCompany({ ...company, logo: made.logo }));
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
            void (async () => {
              // Not an edit, so no ⌘Z: asked first. Projects it was attached to keep their copies.
              const answer = await ask({
                title: t('company.removeTitle', { name: title }),
                text: t('company.removeText'),
                choices: [
                  { id: 'cancel', label: t('common.cancel') },
                  { id: 'remove', label: t('company.removeConfirm'), variant: 'warning' },
                ],
                cancel: 'cancel',
              });
              if (answer === 'remove') onSaved(removeCompany(company.id));
            })();
          }}
        >
          {t('company.remove', { name: title })}
        </Button>
      </div>
    </fieldset>
  );
}

/** What was typed into the colours field as a list: hex colours (with or without the #) split by spaces or commas; `bad` is the first piece that isn't one. */
export function parseBrandColors(text: string): { colors: string[]; bad: string | null } {
  const colors: string[] = [];
  for (const piece of text.split(/[\s,;]+/).filter((p) => p !== '')) {
    const hex = /^#?([0-9a-f]{6})$/i.exec(piece);
    if (!hex?.[1]) return { colors, bad: piece };
    const value = `#${hex[1].toUpperCase()}`;
    if (!colors.includes(value)) colors.push(value);
  }
  return { colors, bad: null };
}

/** The brand kit of a profile (5.4): up to eight colours and three fonts, copied into a project with the rest. */
function BrandKit({ company, fontListId, onSaved }: { company: CompanyProfile; fontListId: string; onSaved: (problem: CompanyProblem | null, words?: string) => void }) {
  const system = useFonts((state) => state.system);
  const families = familiesOf(system);
  const colorsProblemId = useId();
  // What is wrong with the colours field now, said beside it; gone once the value is valid.
  const [colorsProblem, setColorsProblem] = useState<string | null>(null);
  const status = useFonts((state) => state.status);
  const fontProblemId = useId();
  // What is wrong with each font field, by slot, said under it.
  const [fontProblems, setFontProblems] = useState<Readonly<Record<number, string>>>({});
  const setFontProblem = (slot: number, words: string | null) => {
    setFontProblems((now) => {
      if ((now[slot] ?? null) === words) return now;
      const rest = Object.fromEntries(Object.entries(now).filter(([key]) => key !== String(slot)));
      return words === null ? rest : { ...rest, [slot]: words };
    });
  };
  const fontName = (slot: number) => company.brandFonts[slot] ?? '';
  const setFont = (slot: number, family: string) => {
    const next = [...company.brandFonts];
    // A slot cleared ends the list there; later ones move up.
    if (family === '') next.splice(slot, 1);
    else next[slot] = family;
    onSaved(saveCompany({ ...company, brandFonts: next.filter((n, i) => n !== '' && next.indexOf(n) === i) }));
  };
  return (
    <div className="flex flex-col gap-3" data-brand-kit="">
      <div className="flex flex-col gap-1">
        <TextField
          key={`colors:${company.brandColors.join(',')}`}
          label={t('company.brandColors')}
          mono
          defaultValue={company.brandColors.join(' ')}
          placeholder={t('company.brandColorsExample')}
          autoComplete="off"
          data-brand-colors=""
          aria-invalid={colorsProblem !== null || undefined}
          {...(colorsProblem !== null ? { 'aria-describedby': colorsProblemId } : {})}
          onChange={() => {
            setColorsProblem(null);
          }}
          onBlur={(event) => {
            const { colors, bad } = parseBrandColors(event.currentTarget.value);
            const problem = bad !== null ? t('company.brandColorBad', { text: bad }) : colors.length > MAX_BRAND_COLORS ? t('company.brandColorsTooMany', { max: MAX_BRAND_COLORS }) : null;
            setColorsProblem(problem);
            if (problem !== null) {
              event.currentTarget.value = company.brandColors.join(' ');
              return;
            }
            if (JSON.stringify(colors) !== JSON.stringify(company.brandColors)) onSaved(saveCompany({ ...company, brandColors: colors }));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {colorsProblem !== null && (
          <p id={colorsProblemId} role="alert" className="text-[12px]">
            {colorsProblem}
          </p>
        )}
        <p className="text-[11px] text-text-muted">{t('company.brandColorsNote', { max: MAX_BRAND_COLORS })}</p>
        {company.brandColors.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={t('company.brandColors')}>
            {company.brandColors.map((hex) => (
              <li key={hex} className="flex items-center gap-1 border border-border px-1 font-mono text-[11px]">
                <span aria-hidden="true" className="inline-block size-3 border border-text" style={{ backgroundColor: hex }} />
                {hex}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* One list of fonts for every picker (the panel's datalist), not a copy of it in each. */}
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: MAX_BRAND_FONTS }, (_, slot) => {
          const value = fontName(slot);
          // A slot opens once the one before it is set.
          const open = slot === 0 || fontName(slot - 1) !== '';
          const problem = fontProblems[slot] ?? null;
          return (
            <div key={`${String(slot)}:${value}`} className="flex flex-col gap-1">
              <TextField
                label={t('company.brandFont', { n: slot + 1 })}
                list={fontListId}
                defaultValue={value}
                disabled={!open}
                autoComplete="off"
                data-brand-font={slot}
                aria-invalid={problem !== null || undefined}
                {...(problem !== null ? { 'aria-describedby': `${fontProblemId}-${String(slot)}` } : {})}
                onChange={() => {
                  setFontProblem(slot, null);
                }}
                onBlur={(event) => {
                  const typed = event.currentTarget.value.trim();
                  if (typed === value) {
                    setFontProblem(slot, null);
                    return;
                  }
                  // Only a font in the list (the bundled ones and this computer's), or none. Case doesn't matter and the
                  // listed spelling is kept; until the list is known, the name is taken as typed.
                  const listed = typed === '' || status !== 'ready' ? typed : families.find((f) => f.name.toLowerCase() === typed.toLowerCase())?.name;
                  if (listed === undefined) {
                    setFontProblem(slot, t('company.brandFontUnknown', { name: typed }));
                    event.currentTarget.value = value;
                    return;
                  }
                  setFontProblem(slot, null);
                  setFont(slot, listed);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              {problem !== null && (
                <p id={`${fontProblemId}-${String(slot)}`} role="alert" className="text-[12px]">
                  {problem}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
