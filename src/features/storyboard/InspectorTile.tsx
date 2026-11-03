import { useProject } from '../../app/projectStore';
import { sceneFields, shotFields } from '../../core/model/storyboard';
import { setSceneNumber } from './board';
import { InspectorView, type FieldChange } from './InspectorView';
import { useSelection } from './selection';

/** Escape from the inspector: focus goes back to the frame (or the scene) it was showing. */
function focusBoard(shotId: string | null, sceneId: string | null) {
  const target = shotId
    ? document.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(shotId)}"]`)
    : sceneId
      ? document.querySelector<HTMLElement>(`[data-scene-group="${CSS.escape(sceneId)}"] [data-board-item]`)
      : null;
  target?.focus();
}

export function InspectorTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const sceneId = useSelection((s) => s.sceneId);
  const shotId = useSelection((s) => s.shotId);

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  const sceneRecord = sceneId ? records[sceneId] : undefined;
  const scene = sceneRecord?.type === 'scene' && sceneRecord.trashedAt === null ? sceneRecord : undefined;
  const shotRecord = shotId ? records[shotId] : undefined;
  const shot =
    shotRecord?.type === 'shot' && shotRecord.trashedAt === null && shotRecord.parentId === scene?.id ? shotRecord : undefined;
  const otherSceneNumbers = Object.values(records)
    .filter((r) => r.type === 'scene' && r.trashedAt === null && r.id !== scene?.id && r.parentId === project.projectId)
    .map((r) => sceneFields(r.props).number);

  const update = (id: string, { set, unset }: FieldChange) => {
    void apply([{ kind: 'update', id, ...(set ? { set } : {}), ...(unset ? { unset } : {}) }]);
  };

  return (
    <InspectorView
      scene={scene ? { id: scene.id, fields: sceneFields(scene.props) } : null}
      shot={shot ? { id: shot.id, fields: shotFields(shot.props) } : null}
      otherSceneNumbers={otherSceneNumbers}
      onShotChange={(change) => {
        if (shot) update(shot.id, change);
      }}
      onSceneChange={(change) => {
        if (scene) update(scene.id, change);
      }}
      onSceneNumberChange={(number) => {
        // Renumbers its unlocked shots in the same edit.
        if (scene) void apply(setSceneNumber(records, project.projectId, scene.id, number));
      }}
      onBack={() => {
        focusBoard(shot?.id ?? null, scene?.id ?? null);
      }}
    />
  );
}
