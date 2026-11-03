import { showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { useProject } from '../../app/projectStore';
import { mediaFields } from '../../core/media/store';
import { aspectRatioValue, projectStoryboard, sceneFields, shotFields } from '../../core/model/storyboard';
import { addPictures } from './addPictures';
import { setSceneNumber } from './board';
import { pictureView, removePicture, setCrop } from './framePictures';
import { InspectorView, type FieldChange, type InspectorPicture } from './InspectorView';
import { ProjectPictures } from './ProjectPictures';
import { openSketch } from './sketch/sketchStore';
import { strokesOf } from './sketch/strokes';
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

  const fields = shot ? shotFields(shot.props) : null;
  const view = fields ? pictureView(records, fields) : null;
  const media = view && fields?.mediaId ? mediaFields(records[fields.mediaId]?.props ?? {}) : null;
  const picture: InspectorPicture | null =
    view && media ? { view, sourceName: media.sourceName, sourcePath: media.sourcePath } : null;

  const locationId = scene ? sceneFields(scene.props).locationId : null;
  const location = locationId ? records[locationId] : undefined;
  const locationName =
    location && location.trashedAt === null && typeof location.props.name === 'string' ? location.props.name : null;

  return (
    <ProjectPictures>
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
        picture={picture}
        locationName={locationName}
        strokeCount={shot ? strokesOf(records, shot.id).length : 0}
        onSketch={() => {
          if (shot) openSketch(shot.id);
        }}
        frameAspect={aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio)}
        onChoosePicture={() => {
          if (!shot) return;
          choosePictures(false)
            .then((files) => addPictures(files, { kind: 'frame', shotId: shot.id }))
            .catch(showNotice);
        }}
        onRemovePicture={() => {
          if (shot) void apply(removePicture(records, shot.id));
        }}
        onCropChange={(crop) => {
          if (shot) void apply([setCrop(shot.id, crop)]);
        }}
      />
    </ProjectPictures>
  );
}
