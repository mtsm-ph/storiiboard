import { useEffect, useState } from 'react';
import { byNewest, parseBackupFileName } from '../../core/storage/backups';
import { joinPath } from '../../core/storage/openBackup';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { localDateTime } from '../format';
import { showNotice } from '../notice';
import { isTauriApp } from '../fileAccess';
import { openBackup } from '../projects/actions';
import { syncServiceOf } from '../projects/synced';
import { useProject } from '../projectStore';
import { BackupsView, type BackupEntry } from './BackupsView';

export function BackupsPanel() {
  const project = useProject((s) => s.project);
  const [keep, setKeep] = useState(() => loadSettings().backups);
  const [nextToProject, setNextToProject] = useState(() => loadSettings().backupsNextToProject);
  const [found, setFound] = useState<{ folder: string; names: readonly string[]; synced: string | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Bumped after Back up now or a change of folder, so the list is read again.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!project) return;
    let current = true;
    const synced = isTauriApp ? syncServiceOf(project.file.path).catch(() => null) : Promise.resolve(null);
    Promise.all([project.file.backupsFolder(), project.file.listBackups(), synced])
      .then(([folder, names, service]) => {
        if (current) setFound({ folder, names: names.map((backup) => backup.name), synced: service });
      })
      .catch(showNotice);
    return () => {
      current = false;
    };
  }, [project, generation]);

  const entries: BackupEntry[] =
    project && found
      ? byNewest(project.name, found.names).map((name) => ({ name, at: parseBackupFileName(project.name, name) }))
      : [];

  return (
    <BackupsView
      keep={keep}
      onKeepChange={(next) => {
        setKeep(saveSettings({ backups: next }).backups);
      }}
      nextToProject={nextToProject}
      onNextToProjectChange={(next) => {
        setNextToProject(saveSettings({ backupsNextToProject: next }).backupsNextToProject);
        // The open project moves its backups at once; earlier copies stay where they were made.
        project?.file
          .placeBackups(next)
          .then(() => {
            setGeneration((n) => n + 1);
          })
          .catch(showNotice);
      }}
      project={project && found ? { folder: found.folder, backups: entries, synced: found.synced } : null}
      status={status}
      onBackUpNow={() => {
        const schedule = project?.backups;
        if (!schedule) return;
        schedule
          .runNow()
          .then((run) => {
            setStatus(run.created ? `Backed up at ${localDateTime(new Date())}.` : 'Nothing has changed since the last backup.');
            setGeneration((n) => n + 1);
          })
          .catch(showNotice);
      }}
      onShowBackups={() => {
        project?.file.showBackups().catch(showNotice);
      }}
      onOpen={(name) => {
        if (project && found) void openBackup(joinPath(found.folder, name), project.file.path);
      }}
    />
  );
}
