import { useState } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { Button } from '../../ui/Button';
import { Select, TextField, Toggle } from '../../ui/fields';
import { closeExportDialog } from './exportStore';
import { Modal } from './ExportDialog';
import { DEFAULT_WATERMARK, POSITION_LABEL, POSITIONS, readWatermark, watermarkSave, type Watermark, type WatermarkPosition, type WatermarkUse } from './watermark';

// Watermark Settings (1.24, the project menu): the text, where it sits, how strong, and which exports carry it. Saved
// as one edit to the project record, so it undoes like any other and every export reads the same watermark.

const USES: readonly { use: WatermarkUse; label: string }[] = [
  { use: 'pdf', label: 'PDF storyboard' },
  { use: 'png', label: 'PNG frames' },
  { use: 'review', label: 'Web review copy (Phase 9)' },
];

/**
 * Strength, in percent: the same floor readWatermark keeps a stored one to (docs/SBD_FORMAT.md), so a file's 5% shows
 * as 5% and can be set again. A slider with a floor of its own pinned a fainter stored one there, under a label that
 * said otherwise.
 */
export const STRENGTH_MIN = 5;

export function WatermarkDialog() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const stored = project ? readWatermark(records[project.projectId]?.props) : null;
  const [draft, setDraft] = useState<Watermark>(stored ?? DEFAULT_WATERMARK);
  // One for the dialog's life (it's keyed by project), so a second click while the first saves is ignored.
  const [save] = useState(() => (project ? watermarkSave(projectStore, project.projectId, closeExportDialog) : null));
  // Set only by a refused Save, so an earlier edit's error never shows here.
  const [refused, setRefused] = useState(false);
  const error = useProject((s) => s.error);
  if (!project || !save) return null;
  const strength = Math.round(draft.opacity * 100);

  const onSave = () => {
    // Not written: the dialog stays, with the settings, and says why, to try again.
    void save(draft).then((written) => {
      setRefused(!written);
    });
  };

  return (
    <Modal title="Watermark Settings" onClose={closeExportDialog}>
      <TextField
        label="Text"
        value={draft.text}
        maxLength={80}
        placeholder="DRAFT — not for distribution"
        onChange={(event) => {
          setDraft({ ...draft, text: event.currentTarget.value });
        }}
      />
      <div className="flex flex-wrap gap-3">
        <Select
          label="Position"
          value={draft.position}
          onChange={(event) => {
            setDraft({ ...draft, position: event.currentTarget.value as WatermarkPosition });
          }}
        >
          {POSITIONS.map((position) => (
            <option key={position} value={position}>
              {POSITION_LABEL[position]}
            </option>
          ))}
        </Select>
        <label className="flex min-w-[180px] flex-1 flex-col gap-[5px]">
          <span className="sb-label">Strength</span>
          <span className="flex h-[30px] items-center gap-2">
            {/* The kit's ruled range, as the frame inspector's Zoom: square thumb, no radius in either webview. */}
            <input
              type="range"
              min={STRENGTH_MIN}
              max={100}
              step={5}
              value={strength}
              aria-valuetext={`${String(strength)}%`}
              onChange={(event) => {
                setDraft({ ...draft, opacity: Number(event.currentTarget.value) / 100 });
              }}
              className="sb-range min-w-0 flex-1"
            />
            <span className="w-[4ch] text-right font-mono text-[12px]">{`${String(strength)}%`}</span>
          </span>
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="sb-label mb-1">On</legend>
        {USES.map(({ use, label }) => (
          <Toggle
            key={use}
            label={label}
            checked={draft.appliesTo.includes(use)}
            onChange={(on) => {
              setDraft({ ...draft, appliesTo: on ? [...draft.appliesTo, use] : draft.appliesTo.filter((u) => u !== use) });
            }}
          />
        ))}
      </fieldset>
      <p className="text-[12px] text-text-muted">Leave the text empty for no watermark.</p>
      {refused && (
        <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {error ?? 'Not saved: the project file changed on disk.'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={closeExportDialog}>Cancel</Button>
        <Button variant="primary" onClick={onSave}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
