import type { Change } from '../ops/ops';
import type { JsonValue, SbdRecord } from './record';

// Frames taken off the cameras that list them (6.4 review). A camera's `shot_ids` is read by one reader (planCamera.ts)
// that gives a frame to the first camera of its setup, in plan order, that lists it, and an id it can't use (a camera in
// the Trash, a frame now in another setup) waits there so a restore brings the link back. That wait must never hand a
// frame to a camera nobody chose: so a frame given to a camera, set to no camera, or moved out of its setup comes off
// every camera record that lists it, those in the Trash included (an op may update a record in the Trash; its restore
// then brings it back without the frame). A frame's id is its own, so a camera anywhere else that lists it is stale.
// Here, apart from planCamera.ts, so the setup and storyboard edits can use it without importing the plan's readers.

type Records = Readonly<Record<string, SbdRecord>>;

const idsOf = (value: JsonValue | undefined): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id !== '') : []);

/**
 * The frames taken off every camera that lists any of them, but `keep`, as one update per camera: its `shot_ids` without
 * them (unset once empty), and its `shown_shot_id` taken off when it names one. Nothing for a camera that lists none.
 */
export function framesOffCameras(records: Records, shotIds: readonly string[], keep: string | null = null): Change[] {
  const off = new Set(shotIds);
  if (off.size === 0) return [];
  return Object.values(records).flatMap((camera): Change[] => {
    if (camera.type !== 'plan_item' || camera.props.kind !== 'camera' || camera.id === keep) return [];
    const ids = idsOf(camera.props.shot_ids);
    const shown = camera.props.shown_shot_id;
    const listed = ids.some((id) => off.has(id));
    const showing = typeof shown === 'string' && off.has(shown);
    if (!listed && !showing) return [];
    const left = ids.filter((id) => !off.has(id));
    const unset = [...(listed && left.length === 0 ? ['shot_ids'] : []), ...(showing ? ['shown_shot_id'] : [])];
    return [{ kind: 'update', id: camera.id, ...(listed && left.length > 0 ? { set: { shot_ids: left } } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}
