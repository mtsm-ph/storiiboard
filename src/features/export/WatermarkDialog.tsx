import { useState } from 'react';
import { showNotice } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { Button } from '../../ui/Button';
import { Select, TextField } from '../../ui/fields';
import { closeExportDialog } from './exportStore';
import { Modal } from './ExportDialog';
import { DEFAULT_WATERMARK, POSITION_LABEL, POSITIONS, readWatermark, watermarkChange, type Watermark, type WatermarkPosition, type WatermarkUse } from './watermark';

// Watermark Settings (1.24, the project menu): the text, where it sits, how strong, and which exports carry it. Saved
// as one edit to the project record, so it undoes like any other and every export reads the same watermark.

const USES: readonly { use: WatermarkUse; label: string; later?: string }[] = [
  { use: 'pdf', label: 'PDF storyboard' },
  { use: 'png', label: 'PNG frames' },
  { use: 'review', label: 'Web review copy', later: 'Phase 9' },
];

export function WatermarkDialog() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const stored = project ? readWatermark(records[project.projectId]?.props) : null;
  const [draft, setDraft] = useState<Watermark>(stored ?? DEFAULT_WATERMARK);
  if (!project) return null;

  const save = () => {
    const change = watermarkChange(project.projectId, projectStore.getState().records[project.projectId]?.props, draft);
    if (change === null) {
      closeExportDialog();
      return;
    }
    // Not written (an error, shown as a notice): the dialog stays, with the settings, to try again.
    void projectStore.getState().apply([change]).then(closeExportDialog, showNotice);
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
        <label className="flex flex-col gap-[5px]">
          <span className="sb-label">Strength</span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(draft.opacity * 100)}
              aria-valuetext={`${String(Math.round(draft.opacity * 100))}%`}
              onChange={(event) => {
                setDraft({ ...draft, opacity: Number(event.currentTarget.value) / 100 });
              }}
              className="accent-text"
            />
            <span className="font-mono text-[12px]">{`${String(Math.round(draft.opacity * 100))}%`}</span>
          </span>
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sb-label mb-1">On</legend>
        {USES.map(({ use, label, later }) => (
          <label key={use} className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={draft.appliesTo.includes(use)}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                setDraft({ ...draft, appliesTo: on ? [...draft.appliesTo, use] : draft.appliesTo.filter((u) => u !== use) });
              }}
              className="accent-text"
            />
            {label}
            {later && <span className="sb-label text-text-muted">{later}</span>}
          </label>
        ))}
      </fieldset>
      <p className="text-[12px] text-text-muted">Leave the text empty for no watermark.</p>
      <div className="flex justify-end gap-2">
        <Button onClick={closeExportDialog}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
