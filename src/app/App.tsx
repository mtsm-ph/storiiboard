import { lazy, Suspense } from 'react';
import { ThemeProvider } from '../ui/theme/ThemeProvider';
import { AppShell } from './shell/AppShell';

// The UI catalogue is a dev-only page. import.meta.env.DEV is false in production builds, so the bundler drops
// this branch and the catalogue never ships.
const Catalogue = import.meta.env.DEV
  ? lazy(() => import('./catalogue/Catalogue').then((m) => ({ default: m.Catalogue })))
  : null;

function wantsCatalogue(): boolean {
  return typeof window !== 'undefined' && window.location.hash === '#catalogue';
}

export function App() {
  return (
    <ThemeProvider>
      {Catalogue && wantsCatalogue() ? (
        <Suspense fallback={null}>
          <Catalogue />
        </Suspense>
      ) : (
        <AppShell />
      )}
    </ThemeProvider>
  );
}
