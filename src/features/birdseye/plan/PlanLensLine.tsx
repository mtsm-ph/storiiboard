import { showWorkspace } from '../../../app/shell/workspaceStore';
import { t } from '../../../core/i18n';
import { planLensDiffers } from '../../../core/checks';
import { cameraTitle } from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { sceneSetups, setupLabel } from '../../../core/model/setup';
import { Button } from '../../../ui/Button';
import { Trans } from '../../../ui/Trans';
import { iconLabel } from './iconWords';
import { viewKey } from './planItems';
import { planStore } from './planStore';
import { showPlan } from './shownPlan';

// The lens check (6.4 review) where a person changes the lens: by the Inspector's lens field for the selected frame, as
// the gear check shows by its gear (FrameGear.tsx). A camera that had a focal length typed before the frame was linked
// to it now disagrees with the frame's: the line says which camera, on which setup's plan, at what length, and a button
// opens the Setup section on that setup with the camera selected, where "Use the frame's lens" is.

type Records = Readonly<Record<string, SbdRecord>>;

/** The Setup section on a setup's plan, with one of its cameras selected. */
export function openCameraOnPlan(sceneId: string, setupId: string, cameraId: string): void {
  showPlan(sceneId, setupId);
  planStore.getState().select(viewKey(sceneId, setupId), [cameraId]);
  showWorkspace('setup');
}

export function PlanLensLine({ records, projectId, shotId }: { records: Records; projectId: string; shotId: string }) {
  const findings = planLensDiffers(records, projectId).filter((f) => f.shotId === shotId);
  if (findings.length === 0) return null;
  return (
    // Not a live region, as the gear check isn't: it's there from the moment the frame is picked.
    <div data-plan-lens-check="" className="flex flex-col gap-2 text-[12px]">
      {findings.map((finding) => {
        const setup = sceneSetups(records, finding.sceneId).find((s) => s.record.id === finding.setupId);
        const setupName = setup ? setupLabel(setup) : t('history.aSetup');
        const camera = cameraTitle(records, finding.cameraId, iconLabel);
        return (
          <div key={finding.cameraId} className="flex flex-wrap items-center gap-2">
            <span className="sb-label bg-warning px-[5px] text-paper-fixed">{t('selection.camera.lensCheck')}</span>
            <span>
              <Trans k="inspector.planLens" parts={{ camera, setup: setupName, mm: <span className="font-mono">{t('lens.prime', { mm: finding.cameraMm })}</span> }} />
            </span>
            <Button
              data-open-plan-camera={finding.cameraId}
              aria-label={t('inspector.planLensOpenNamed', { camera, setup: setupName })}
              onClick={() => {
                openCameraOnPlan(finding.sceneId, finding.setupId, finding.cameraId);
              }}
            >
              {t('inspector.planLensOpen')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
