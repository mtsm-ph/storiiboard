import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, type LocaleId } from '../core/i18n';

/**
 * The app's language, for the root of the tree: a change of language re-renders everything under the component that
 * reads it, and every screen reads its words from t() as it renders. Components deeper down don't need it.
 */
export function useLocale(): LocaleId {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
