import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { loadSettings, saveSettings, type ThemePreference } from '../../core/storage/settings';
import { applyTokens, type ProjectTheme } from './projectTheme';
import { applyTheme, DARK_QUERY, resolveTheme, type ResolvedTheme } from './theme';

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function osPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function subscribeToOs(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

interface ThemeProviderProps {
  children: ReactNode;
  /** The open project's own theme (1.15); null for none open, or one on the kit's. */
  projectTheme?: ProjectTheme | null;
  /** Told the background colour each time it changes, for the window behind the page (the desktop app). */
  onBackground?: (colour: string | null) => void;
}

export function ThemeProvider({ children, projectTheme = null, onBackground }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => loadSettings().theme);
  // Follow the OS live, so "System" tracks a Mac switching to dark at sunset. useSyncExternalStore re-reads the
  // OS after subscribing, so a switch between the first render and the subscription is not lost. Server renders
  // (the unit tests) have no OS to ask and render light.
  const osDark = useSyncExternalStore(subscribeToOs, osPrefersDark, () => false);

  const resolved = resolveTheme(preference, osDark, projectTheme?.mode ?? null);
  const tokens = projectTheme ? projectTheme[resolved] : null;

  useEffect(() => {
    applyTheme(resolved);
    applyTokens(tokens);
    onBackground?.(tokens?.bg ?? null);
  }, [resolved, tokens, onBackground]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    saveSettings({ theme: next });
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error('useTheme needs a <ThemeProvider> above it');
  return state;
}
