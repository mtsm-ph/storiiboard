import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { cleanProfileText, loadSettings, saveSettings } from '../../core/storage/settings';
import { COMPANY_FIELDS, LOGO_EDGE, MAX_COMPANIES, MAX_COMPANY_TEXT, MAX_LOGO_CHARS, type CompanyProfile } from '../../core/model/company';

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

/** Saves the list; false when the settings couldn't hold it (full, or blocked), and nothing changed. */
function store(companies: CompanyProfile[]): boolean {
  saveSettings({ companies });
  // Read back: a full store refuses the write without saying so (settings.ts).
  const kept = loadSettings().companies;
  const ok = JSON.stringify(kept) === JSON.stringify(companies);
  companiesStore.setState({ companies: ok ? companies : kept });
  return ok;
}

/** Adds a new, empty profile and gives its id; null when there are already MAX_COMPANIES or it couldn't be saved. */
export function addCompany(): string | null {
  const { companies } = companiesStore.getState();
  if (companies.length >= MAX_COMPANIES) return null;
  const id = crypto.randomUUID();
  return store([...companies, { id, name: '', address: '', phone: '', email: '', website: '', logo: null }]) ? id : null;
}

/** Saves a change to a profile; false when it couldn't be saved. */
export function saveCompany(profile: CompanyProfile): boolean {
  const { companies } = companiesStore.getState();
  return store(companies.map((c) => (c.id === profile.id ? cleaned(profile) : c)));
}

/** Removes a profile from this computer; projects it was attached to keep their copies. */
export function removeCompany(id: string): boolean {
  return store(companiesStore.getState().companies.filter((c) => c.id !== id));
}

/**
 * A picture made into a profile's logo: fitted inside LOGO_EDGE px, kept as a PNG data URL (transparency kept). Null
 * when it can't be read or comes out too large to keep.
 */
export async function logoFromPicture(bytes: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(bytes, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  const scale = Math.min(1, LOGO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL('image/png');
  return url.length <= MAX_LOGO_CHARS ? url : null;
}

/** A logo's data URL as a file, for the project's own picture of it. */
export async function logoFile(logo: string, name: string): Promise<File> {
  const blob = await (await fetch(logo)).blob();
  return new File([blob], name, { type: 'image/png' });
}
