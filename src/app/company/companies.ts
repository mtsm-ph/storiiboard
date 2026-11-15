import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { cleanProfileText, loadSettings, saveSettings } from '../../core/storage/settings';
import { cleanBrandColors, cleanBrandFonts, COMPANY_FIELDS, LOGO_EDGE, MAX_ALL_LOGOS_CHARS, MAX_COMPANIES, MAX_COMPANY_TEXT, MAX_LOGO_CHARS, type CompanyProfile } from '../../core/model/company';

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
  next.brandColors = cleanBrandColors(profile.brandColors);
  next.brandFonts = cleanBrandFonts(profile.brandFonts);
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
  return store([...companies, { id: crypto.randomUUID(), name: '', address: '', phone: '', email: '', website: '', logo: null, brandColors: [], brandFonts: [] }]);
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

/** A logo's data URL as a file, for the project's own picture of it. Rejects a string that isn't a base64 data URL. */
export function logoFile(logo: string, name: string): Promise<File> {
  // A throw inside the executor becomes the rejection, so callers' await sees it as before.
  return new Promise((resolve) => {
    resolve(decodeLogo(logo, name));
  });
}

function decodeLogo(logo: string, name: string): File {
  // Decoded by hand, never fetched: the installed app's CSP (connect-src) refuses a fetch of a data: URL, and the dev
  // server sends no CSP, so a fetch here worked in every test and failed for everyone with a logo.
  // The English of error.notAnImage, as prepareImage raises it, so localizeError shows it in the person's language.
  const unreadable = 'This file isn’t an image Storiiboard can read. JPEG, PNG and WebP work.';
  const match = /^data:([^;,]*)((?:;[^;,]*)*);base64,(.*)$/s.exec(logo);
  const [, type, , data] = match ?? [];
  if (!data) throw new Error(unreadable);
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw new Error(unreadable);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: type || 'image/png' });
}
