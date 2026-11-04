import { useProject } from '../../app/projectStore';
import { chooseScriptToImport } from '../script/chooseAndRead';
import { addScene, board, coverage, setNumbersLocked } from './board';
import { ScenesView } from './ScenesView';
import { useSelection } from './selection';

export function ScenesTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const activeSceneId = useSelection((s) => s.sceneId);
  const selectScene = useSelection((s) => s.selectScene);
  const scenes = project ? board(records, project.projectId) : [];

  return (
    <ScenesView
      scenes={scenes.map((scene) => ({
        id: scene.record.id,
        fields: scene.fields,
        frames: scene.shots.length,
        coverage: coverage([scene]),
      }))}
      activeSceneId={activeSceneId}
      coverage={coverage(scenes)}
      canAdd={project !== null}
      onSelect={selectScene}
      onToggleLock={(id, locked) => {
        if (project) void apply(setNumbersLocked(records, project.projectId, id, locked));
      }}
      onImport={() => {
        void chooseScriptToImport();
      }}
      onAdd={() => {
        if (!project) return;
        const change = addScene(records, project.projectId);
        void apply([change]).then(() => {
          selectScene(change.record.id);
        });
      }}
    />
  );
}
