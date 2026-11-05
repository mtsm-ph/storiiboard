import { lazy, Suspense } from 'react';
import { ProjectAppearance } from './projectAppearance';
import { AppShell } from './shell/AppShell';
import { useLocale } from '../ui/useLocale';

// The UI catalogue is a dev-only page. import.meta.env.DEV is false in production builds, so the bundler drops
// this branch and the catalogue never ships.
const Catalogue = import.meta.env.DEV
  ? lazy(() => import('./catalogue/Catalogue').then((m) => ({ default: m.Catalogue })))
  : null;

function wantsCatalogue(): boolean {
  return typeof window !== 'undefined' && window.location.hash === '#catalogue';
}

export function App() {
  // Read here so a change of language re-renders the whole app (src/core/i18n).
  useLocale();
  return (
    <ProjectAppearance>
      {Catalogue && wantsCatalogue() ? (
        <Suspense fallback={null}>
          <Catalogue />
        </Suspense>
      ) : (
        <AppShell />
      )}
    </ProjectAppearance>
  );
}
