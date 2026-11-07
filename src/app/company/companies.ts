import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { cleanProfileText, loadSettings, saveSettings } from '../../core/storage/settings';
import { COMPANY_FIELDS, LOGO_EDGE, MAX_ALL_LOGOS_CHARS, MAX_COMPANIES, MAX_COMPANY_TEXT, MAX_LOGO_CHARS, type CompanyProfile } from '../../core/model/company';

// The company profiles saved on this computer (3.2), in the app's settings: the person's, never the project's, so
// they're not ops and don't undo. A project gets a copy when one is attached to it (companyEdits.ts).

export const companiesStore = createStore<{ companies: CompanyProfile[] }>()(() => ({ companies: loadSettings().companies }));

export function useCompanies(): CompanyProfile[] {
  return useStore(companiesStore, (s) => s.companies);
}

/** A profile's text as kept: trimmed, without control characters, at most MAX_COMPANY_TEXT characters. */
function cleaned(profile: CompanyProfile): CompanyProfile {
  const next = { ...profile };
  for (const field of COMPANY_FIELDS) next[field] = cleanProfileText(profile[field], MAX_COMPANY_TEXT);
  return next;
}

/** Why a profile change wasn't kept. */
export type CompanyProblem = 'notSaved' | 'tooManyLogos';

/** The characters every profile's logo takes together. */
const logoChars = (companies: readonly CompanyProfile[]) => companies.reduce((n, c) => n + (c.logo?.length ?? 0), 0);

/** Saves the list; a problem when the settings couldn't hold it (full, or blocked) or the logos are too many. */
function store(companies: CompanyProfile[]): CompanyProblem | null {
  if (logoChars(companies) > MAX_ALL_LOGOS_CHARS && logoChars(companies) > logoChars(companiesStore.getState().companies)) return 'tooManyLogos';
  saveSettings({ companies });
  // Read back: a full store refuses the write without saying so (settings.ts).
  const kept = loadSettings().companies;
  const ok = JSON.stringify(kept) === JSON.stringify(companies);
  companiesStore.setState({ companies: ok ? companies : kept });
  return ok ? null : 'notSaved';
}

/** Adds a new, empty profile; a problem when it couldn't be saved. At most MAX_COMPANIES (the button is off past it). */
export function addCompany(): CompanyProblem | null {
  const { companies } = companiesStore.getState();
  if (companies.length >= MAX_COMPANIES) return 'notSaved';
  return store([...companies, { id: crypto.randomUUID(), name: '', address: '', phone: '', email: '', website: '', logo: null }]);
}

/** Saves a change to a profile; a problem when it couldn't be saved. */
export function saveCompany(profile: CompanyProfile): CompanyProblem | null {
  const { companies } = companiesStore.getState();
  return store(companies.map((c) => (c.id === profile.id ? cleaned(profile) : c)));
}

/** Removes a profile from this computer; projects it was attached to keep their copies. */
export function removeCompany(id: string): CompanyProblem | null {
  return store(companiesStore.getState().companies.filter((c) => c.id !== id));
}

/**
 * A picture made into a profile's logo: fitted inside LOGO_EDGE px, kept as a PNG data URL (transparency kept), made
 * smaller still until it fits MAX_LOGO_CHARS (a photographic logo is heavy as a PNG). `unreadable` when it can't be read.
 */
export async function logoFromPicture(bytes: Blob): Promise<{ logo: string } | 'unreadable'> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(bytes, { imageOrientation: 'from-image' });
  } catch {
    return 'unreadable';
  }
  try {
    let edge = LOGO_EDGE;
    for (;;) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      if (url.length <= MAX_LOGO_CHARS) return { logo: url };
      if (edge <= 64) return 'unreadable';
      edge = Math.round(edge * 0.75);
    }
  } finally {
    bitmap.close();
  }
}

/** A logo's data URL as a file, for the project's own picture of it. */
export async function logoFile(logo: string, name: string): Promise<File> {
  const blob = await (await fetch(logo)).blob();
  return new File([blob], name, { type: 'image/png' });
}
