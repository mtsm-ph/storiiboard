import { invoke } from '@tauri-apps/api/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { loadSettings, saveSettings, type WeekStartChoice } from '../core/storage/settings';
import { isTauriApp } from './fileAccess';

// The week's first day (3.17, Kevin Nov 9): the one this computer's regional settings say, in every language, unless
// Settings → App sets Sunday or Monday. On the desktop the region is read by Rust (src-tauri/src/region.rs: Windows'
// regional first day, a Mac's Language & Region), since a webview knows the app's language, not the region's
// formats; else the browser's language stands in. 0 is Sunday … 6 Saturday, as the Calendar counts.

interface RegionWeek {
  firstDay: number | null;
  locale: string | null;
}

/** Where the week starts by the region (CLDR's weekData), for an engine without Intl's week info. Monday elsewhere. */
const SUNDAY = new Set(
  'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'.split(' '),
);
const SATURDAY = new Set('AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '));
const FRIDAY = new Set(['MV']);

interface WeekInfo {
  firstDay?: number;
}
type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

/** The first day a locale's region starts the week on, or null for a locale that names no region and isn't read. */
export function regionFirstDay(locale: string): number | null {
  try {
    const parsed = new Intl.Locale(locale) as LocaleWithWeek;
    const info = typeof parsed.getWeekInfo === 'function' ? parsed.getWeekInfo() : parsed.weekInfo;
    // Intl counts 1 Monday … 7 Sunday.
    if (info?.firstDay !== undefined && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7;
    const region = parsed.region ?? parsed.maximize().region;
    if (!region) return null;
    return SUNDAY.has(region) ? 0 : SATURDAY.has(region) ? 6 : FRIDAY.has(region) ? 5 : 1;
  } catch {
    return null;
  }
}

/** The day the week starts on: the choice, else the computer's first day, else its region's, else the browser's. */
export function firstDayOf(choice: WeekStartChoice, region: RegionWeek | null, language: string): number {
  if (choice === 'sunday') return 0;
  if (choice === 'monday') return 1;
  const set = region?.firstDay;
  if (set !== undefined && set !== null && Number.isInteger(set) && set >= 0 && set <= 6) return set;
  return (region?.locale ? regionFirstDay(region.locale) : null) ?? regionFirstDay(language) ?? 0;
}

const store = createStore<{ choice: WeekStartChoice; region: RegionWeek | null }>()(() => ({ choice: loadSettings().weekStart, region: null }));

// The computer's region, read once as the app starts on the desktop, so the Calendar draws its first week right the
// first time. One that can't be read leaves the language's region to stand in.
if (isTauriApp) {
  invoke<RegionWeek>('region_week').then(
    (region) => {
      store.setState({ region });
    },
    () => undefined,
  );
}

/** Where the week starts now, following Settings and the computer. */
export function useFirstDay(): number {
  const { choice, region } = useStore(store);
  return firstDayOf(choice, region, typeof navigator === 'undefined' ? 'en-US' : navigator.language);
}

/** The computer's region as a locale (`es-MX`), else the browser's language: where the forecast's units come from too. */
export function useRegionLocale(): string {
  const region = useStore(store, (s) => s.region);
  return region?.locale ?? (typeof navigator === 'undefined' ? 'en-US' : navigator.language);
}

export const useWeekStartChoice = (): WeekStartChoice => useStore(store, (s) => s.choice);

export function setWeekStartChoice(choice: WeekStartChoice): void {
  saveSettings({ weekStart: choice });
  store.setState({ choice });
}
