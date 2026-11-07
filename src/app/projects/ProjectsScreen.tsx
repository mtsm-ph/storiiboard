import { useEffect } from 'react';
import { useProject } from '../projectStore';
import { canOpenFiles } from '../fileAccess';
import { importProjectData, newProject, openBackupWithDialog, openRecent, openWithDialog, recentStore } from './actions';
import { ProjectsView } from './ProjectsView';
import { useRecent } from './recentStore';

export function ProjectsScreen() {
  const recent = useRecent(recentStore, (s) => s.entries);
  const openPath = useProject((s) => s.project?.file.path ?? null);

  useEffect(() => {
    void recentStore.getState().refresh();
  }, []);

  return (
    <ProjectsView
      recent={recent}
      openPath={openPath}
      canOpen={canOpenFiles}
      onNew={() => void newProject()}
      onOpen={() => void openWithDialog()}
      onOpenRecent={(path) => void openRecent(path)}
      onForget={(path) => void recentStore.getState().forget(path)}
      onOpenBackup={() => void openBackupWithDialog()}
      onImportData={() => void importProjectData()}
    />
  );
}
