import { showInfo } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { sceneFields } from '../../core/model/storyboard';
import { chooseScriptToImport } from '../script/chooseAndRead';
import { addScene, board, coverage, lockNotice, relettered, setNumbersLocked } from './board';
import { ScenesView } from './ScenesView';
import { paletteOf } from '../../core/model/palette';
import { deleteScene, focusSceneAfterDelete } from './deleteScene';
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
        palette: paletteOf(scene.record.props)?.colors.map((c) => c.hex) ?? [],
      }))}
      activeSceneId={activeSceneId}
      coverage={coverage(scenes)}
      canAdd={project !== null}
      onSelect={selectScene}
      onToggleLock={(id, locked) => {
        if (!project) return;
        // From the records and slate numbers as they are at its turn: locking may re-letter frames (1.26), and the
        // person is told which, once it's written.
        let notice: string | null = null;
        void applyWith((now, slate) => {
          const changes = setNumbersLocked(now, project.projectId, id, locked, slate);
          if (locked) notice = lockNotice(sceneFields(now[id]?.props ?? {}).number, relettered(now, project.projectId, changes, slate));
          return { changes };
        }).then((written) => {
          if (written && notice) showInfo(notice, { step: true });
        });
      }}
      onDelete={(id) => {
        void deleteScene(id).then(({ written, next }) => {
          // Focus to the scene that took its place, or + New scene once none is left.
          if (written) focusSceneAfterDelete(next, 'data-scene-row', () => document.querySelector<HTMLElement>('[data-new-scene]'));
        });
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
