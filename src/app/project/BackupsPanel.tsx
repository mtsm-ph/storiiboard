import { useEffect, useState } from 'react';
import { byNewest, parseBackup, type BackupKeep } from '../../core/storage/backups';
import { useDraft } from '../settings/drafts';
import { joinPath } from '../../core/storage/openBackup';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { localDateTime } from '../format';
import { showNotice } from '../notice';
import { isTauriApp } from '../fileAccess';
import { openBackup } from '../projects/actions';
import { syncServiceOf } from '../projects/synced';
import { projectStore, useProject } from '../projectStore';
import { BackupsView, type BackupEntry } from './BackupsView';
import { t } from '../../core/i18n';

export function BackupsPanel() {
  const project = useProject((s) => s.project);
  const [found, setFound] = useState<{ folder: string; names: readonly string[]; synced: string | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Bumped after Back up now, a change of folder or any backup landing, so the list is read again.
  const [generation, setGeneration] = useState(0);
  // Both wait for Apply changes (drafts.ts), as every setting of this computer's in Settings; read as applied each time
  // the tab draws, so an Apply shows at once. Back up now, Show backups and Open act at once: they're actions.
  const applied = loadSettings();
  const [keep, draftKeep] = useDraft<BackupKeep>('backups', applied.backups, (next) => {
    saveSettings({ backups: next });
  });
  const [nextToProject, draftNextToProject] = useDraft<boolean>('backupsNextToProject', applied.backupsNextToProject, (next) => {
    saveSettings({ backupsNextToProject: next });
    // The project open when it's applied moves its backups at once; earlier copies stay where they were made.
    projectStore
      .getState()
      .project?.file.placeBackups(next)
      .then(() => {
        setGeneration((n) => n + 1);
      })
      .catch(showNotice);
  });

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

  // Any backup landing (the 5-minute run, a queued hand one, Ctrl+S) reads the list again. The schedule tells it once
  // the copy it replaced and pruning's are gone, so the list never shows a file just deleted.
  useEffect(() => {
    const schedule = project?.backups;
    if (!schedule) return;
    return schedule.onBackup(() => {
      setGeneration((n) => n + 1);
    });
  }, [project]);

  const entries: BackupEntry[] =
    project && found
      ? byNewest(project.name, found.names).map((name) => {
          const parsed = parseBackup(project.name, name);
          return { name, at: parsed?.at ?? null, copy: parsed?.copy ?? 1 };
        })
      : [];

  return (
    <BackupsView
      keep={keep}
      onKeepChange={draftKeep}
      nextToProject={nextToProject}
      onNextToProjectChange={draftNextToProject}
      project={project && found ? { folder: found.folder, backups: entries, synced: found.synced } : null}
      status={status}
      onBackUpNow={() => {
        const schedule = project?.backups;
        if (!project || !schedule) return;
        // The answer is this project's: one switched to meanwhile never shows it, as with Ctrl+S (pressSave).
        const stillOpen = () => projectStore.getState().project === project;
        // The hand-backup rule (Kevin, Nov 18), one with Ctrl+S: a press under a minute after the newest backup waits
        // until that minute is up.
        schedule
          .backUpByHand()
          .then((run) => {
            if (!stillOpen()) return;
            setStatus(
              run.kind === 'nothing'
                ? t('backups.nothingChanged')
                : run.kind === 'queued'
                  ? t('backups.queued', { time: localDateTime(run.at) })
                  : t('backups.backedUpAt', { time: localDateTime(new Date()) }),
            );
            setGeneration((n) => n + 1);
          })
          .catch((error: unknown) => {
            if (stillOpen()) showNotice(error);
          });
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
