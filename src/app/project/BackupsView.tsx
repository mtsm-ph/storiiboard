import { useId, useState } from 'react';
import type { BackupKeep } from '../../core/storage/backups';
import { KEEP_LIMITS } from '../../core/storage/settings';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { localDateTime } from '../format';

// The Backups tile in Settings: how many copies to keep (the person's setting, for every project), and the open
// project's backups, newest first, each of which opens as a separate project. This part only draws.

export interface BackupEntry {
  name: string;
  /** From the file name; null for a name that doesn't parse, which then sorts last. */
  at: Date | null;
}

export interface BackupsViewProps {
  keep: BackupKeep;
  onKeepChange: (keep: BackupKeep) => void;
  /** Null with no project open. */
  project: { folder: string; backups: readonly BackupEntry[] } | null;
  /** What the last Back up now did, for the live region. */
  status: string | null;
  onBackUpNow: () => void;
  onOpen: (name: string) => void;
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

export function BackupsView({ keep, onKeepChange, project, status, onBackUpNow, onOpen }: BackupsViewProps) {
  const helpId = useId();
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid max-w-[420px] grid-cols-2 gap-3">
        <KeepField key={`r${String(keep.recent)}`} label="Keep the last" field="recent" keep={keep} onKeepChange={onKeepChange} helpId={helpId} />
        <KeepField key={`d${String(keep.days)}`} label="Plus one a day for" field="days" keep={keep} onKeepChange={onKeepChange} helpId={helpId} />
      </div>
      <p id={helpId} className="text-[12px] text-text-muted">
        Copies, then days. Every 5 minutes, if anything changed, a full copy goes to a Backups folder next to the
        project. Older copies are deleted; these numbers apply to every project.
      </p>
      {project === null ? (
        <p className="sb-label text-text-muted">No project open.</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button onClick={onBackUpNow}>Back up now</Button>
            <p role="status" className="text-[12px]">
              {status}
            </p>
          </div>
          <p className="font-mono text-[11px] text-text-muted">{project.folder}</p>
          {project.backups.length === 0 ? (
            <p className="text-[13px] text-text-muted">No backups yet. The first comes 5 minutes after an edit.</p>
          ) : (
            <ul aria-label="Backups" className="border-t border-border">
              {project.backups.map((backup) => (
                <li key={backup.name} className="flex items-center gap-3 border-b border-border py-1.5">
                  <span className="font-mono text-[12px]">{backup.at ? localDateTime(backup.at) : backup.name}</span>
                  <Button
                    className="ml-auto"
                    aria-label={`Open the ${backup.at ? localDateTime(backup.at) : backup.name} backup as a separate project`}
                    onClick={() => {
                      onOpen(backup.name);
                    }}
                  >
                    Open
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
