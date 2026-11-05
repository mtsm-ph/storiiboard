import { useId, useState } from 'react';
import type { BackupKeep } from '../../core/storage/backups';
import { KEEP_LIMITS } from '../../core/storage/settings';
import { Button } from '../../ui/Button';
import { TextField, Toggle } from '../../ui/fields';
import { localDateTime } from '../format';
import { t } from '../../core/i18n';

// The Backups tile in Settings: how many copies to keep (the person's setting, for every project), and the open
// project's backups, newest first, each of which opens as a separate project. This part only draws.

export interface BackupEntry {
  name: string;
  /** From the file name; null for a name that doesn't parse, which then sorts last. */
  at: Date | null;
  /** Which backup of that minute: 1, or 2 for `… (2).sbd` (1.28). */
  copy?: number;
}

/** "2026-11-04 18:30", or "2026-11-04 18:30 (2)" for that minute's second backup, so no two rows read alike. */
function backupLabel(backup: BackupEntry): string {
  if (!backup.at) return backup.name;
  return `${localDateTime(backup.at)}${backup.copy && backup.copy > 1 ? ` (${String(backup.copy)})` : ''}`;
}

export interface BackupsViewProps {
  keep: BackupKeep;
  onKeepChange: (keep: BackupKeep) => void;
  /** The person's setting: keep a synced project's backups next to it instead of on this computer. */
  nextToProject: boolean;
  onNextToProjectChange: (next: boolean) => void;
  /** Null with no project open. `synced` names the sync service the project is in, if any. */
  project: { folder: string; backups: readonly BackupEntry[]; synced: string | null } | null;
  /** What the last Back up now did, for the live region. */
  status: string | null;
  onBackUpNow: () => void;
  onShowBackups: () => void;
  onOpen: (name: string) => void;
}

/** Where this project's backups are, and why, in a line. */
export function placeNote(synced: string | null, nextToProject: boolean): string {
  if (synced === null) return t('backups.placeLocal');
  return nextToProject ? t('backups.placeSyncedNext', { service: synced }) : t('backups.placeSyncedLocal', { service: synced });
}

/** A whole number in range, or null for anything else, which leaves the setting as it was. */
export function parseKeep(text: string, field: keyof BackupKeep): number | null {
  const { min, max } = KEEP_LIMITS[field];
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

interface KeepFieldProps extends Pick<BackupsViewProps, 'keep' | 'onKeepChange'> {
  label: string;
  field: keyof BackupKeep;
  helpId: string;
}

function KeepField({ label, field, keep, onKeepChange, helpId }: KeepFieldProps) {
  // The parent keys this by the saved value, so a refused entry snaps back to it.
  const [draft, setDraft] = useState(String(keep[field]));
  return (
    <TextField
      label={label}
      mono
      inputMode="numeric"
      value={draft}
      aria-describedby={helpId}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onBlur={() => {
        const value = parseKeep(draft, field);
        if (value === null) setDraft(String(keep[field]));
        else if (value !== keep[field]) onKeepChange({ ...keep, [field]: value });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export function BackupsView({
  keep,
  onKeepChange,
  nextToProject,
  onNextToProjectChange,
  project,
  status,
  onBackUpNow,
  onShowBackups,
  onOpen,
}: BackupsViewProps) {
  const helpId = useId();
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid max-w-[420px] grid-cols-2 gap-3">
        <KeepField key={`r${String(keep.recent)}`} label={t('backupsView.keepTheLast')} field="recent" keep={keep} onKeepChange={onKeepChange} helpId={helpId} />
        <KeepField key={`d${String(keep.days)}`} label={t('backupsView.plusOneADayFor')} field="days" keep={keep} onKeepChange={onKeepChange} helpId={helpId} />
      </div>
      <p id={helpId} className="text-[12px] text-text-muted">
        {t('backupsView.copiesThenDaysEvery5')}
      </p>
      <div className="flex max-w-[420px] flex-col gap-1.5">
        <Toggle
          label={t('backupsView.keepSyncedProjectsBackupsNext')}
          checked={nextToProject}
          onChange={onNextToProjectChange}
        />
        <p className="text-[12px] text-text-muted">
          {t('backupsView.offBackupsOfAProject')}
        </p>
      </div>
      {project === null ? (
        <p className="sb-label text-text-muted">{t('backupsView.noProjectOpen')}</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button onClick={onBackUpNow}>{t('backupsView.backUpNow')}</Button>
            <Button onClick={onShowBackups}>{t('backupsView.showBackups')}</Button>
            <p role="status" className="text-[12px]">
              {status}
            </p>
          </div>
          <p className="text-[12px]">{placeNote(project.synced, nextToProject)}</p>
          <p className="font-mono text-[11px] text-text-muted">{project.folder}</p>
          {project.backups.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('backupsView.noBackupsYetTheFirst')}</p>
          ) : (
            <ul aria-label={t('backupsView.backups')} className="border-t border-border">
              {project.backups.map((backup) => (
                <li key={backup.name} className="flex items-center gap-3 border-b border-border py-1.5">
                  <span className="font-mono text-[12px]">{backupLabel(backup)}</span>
                  <Button
                    className="ml-auto"
                    aria-label={t('backups.openLabel', { name: backupLabel(backup) })}
                    onClick={() => {
                      onOpen(backup.name);
                    }}
                  >
                    {t('backupsView.open')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
