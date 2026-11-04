import { useProject } from '../../app/projectStore';
import { chooseScriptToImport } from '../script/chooseAndRead';
import { addScene, board, coverage, setNumbersLocked } from './board';
import { ScenesView } from './ScenesView';
import { useSelection } from './selection';

export function ScenesTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const applyWith = useProject((s) => s.applyWith);
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
        // From the records and slate numbers as they are at its turn: locking may renumber a frame (1.26).
        if (project) void applyWith((now, slate) => ({ changes: setNumbersLocked(now, project.projectId, id, locked, slate) }));
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
