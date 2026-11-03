import { useEffect, useState } from 'react';
import { parseBackupFileName } from '../../core/storage/backups';
import { backupPath, backupsFolder } from '../../core/storage/openBackup';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { localDateTime } from '../format';
import { showNotice } from '../notice';
import { openBackup } from '../projects/actions';
import { useProject } from '../projectStore';
import { BackupsView, type BackupEntry } from './BackupsView';

export function BackupsPanel() {
  const project = useProject((s) => s.project);
  const [keep, setKeep] = useState(() => loadSettings().backups);
  const [names, setNames] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  // Bumped after Back up now, so the list is read again.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let current = true;
    project?.file
      .listBackups()
      .then((list) => {
        if (current) setNames(list);
      })
      .catch(showNotice);
    return () => {
      current = false;
    };
  }, [project, generation]);

  const entries: BackupEntry[] = project
    ? names
        .map((name) => ({ name, at: parseBackupFileName(project.name, name) }))
        .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    : [];

  return (
    <BackupsView
      keep={keep}
      onKeepChange={(next) => {
        setKeep(saveSettings({ backups: next }).backups);
      }}
      project={project ? { folder: backupsFolder(project.file.path), backups: entries } : null}
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
      onOpen={(name) => {
        if (project) void openBackup(backupPath(project.file.path, name));
      }}
    />
  );
}
