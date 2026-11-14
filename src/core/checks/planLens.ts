import { cameraFields, planFields } from '../model/plan';
import { cameraSetupId, framesDiffering } from '../model/planCamera';
import type { SbdRecord } from '../model/record';

// The lens check (6.4; CLAUDE.md "MCP server: Checks": the storyboard lens differs from the camera lens in the
// bird's-eye plan). A camera placed before it had a frame carries a typed focal length (`lens_mm`); once a frame shot
// from it says another, the two disagree. A camera with no typed lens draws its frames' lenses, so it never can. Only
// live records count: a camera, a setup, a scene or a frame in the Trash isn't a mistake.

type Records = Readonly<Record<string, SbdRecord>>;

export interface PlanLensDiffers {
  kind: 'plan-lens-differs';
  sceneId: string;
  setupId: string;
  cameraId: string;
  shotId: string;
  /** The focal length the frame uses, mm. */
  frameMm: number;
  /** The focal length typed on the camera, mm. */
  cameraMm: number;
}

/** Worked out once per set of records. */
const cache = new WeakMap<Records, Map<string, PlanLensDiffers[]>>();

/** Every live camera of the project's live setups whose typed lens differs from a frame shot from it; by plan, frames in board order. */
export function planLensDiffers(records: Records, projectId: string): PlanLensDiffers[] {
  let byProject = cache.get(records);
  if (!byProject) {
    byProject = new Map();
    cache.set(records, byProject);
  }
  const known = byProject.get(projectId);
  if (known) return known;
  const cameras = Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.trashedAt === null && (cameraFields(r.props)?.lensMm ?? null) !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const found = cameras.flatMap((camera) => {
    const setupId = cameraSetupId(records, camera);
    const setup = setupId ? records[setupId] : undefined;
    const scene = setup?.parentId ? records[setup.parentId] : undefined;
    if (!setupId || scene?.type !== 'scene' || scene.trashedAt !== null || scene.parentId !== projectId) return [];
    const plan = camera.parentId ? records[camera.parentId] : undefined;
    if (!plan || planFields(plan.props)?.kind !== 'setup') return [];
    return framesDiffering(records, camera.id).map(
      (d): PlanLensDiffers => ({ kind: 'plan-lens-differs', sceneId: scene.id, setupId, cameraId: camera.id, shotId: d.shot.id, frameMm: d.frameMm, cameraMm: d.cameraMm }),
    );
  });
  byProject.set(projectId, found);
  return found;
}
