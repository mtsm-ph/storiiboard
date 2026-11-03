import { lazy, Suspense } from 'react';
import { closeSketch, useSketchShot } from './sketchStore';

// The sketch editor loads on first use: Konva is only needed there, so it stays out of the app's first load.
const SketchEditor = lazy(() => import('./SketchEditor'));

export function SketchHost() {
  const shotId = useSketchShot();
  if (!shotId) return null;
  return (
    <Suspense fallback={null}>
      <SketchEditor key={shotId} shotId={shotId} onClose={closeSketch} />
    </Suspense>
  );
}
