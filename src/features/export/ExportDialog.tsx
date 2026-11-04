import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isTauriApp } from '../../app/fileAccess';
import { showInfo, showNotice } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { sceneLabel } from '../../core/model/storyboard';
import { chooseExportFile, chooseExportFolder } from '../../core/storage/exportFiles';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { board } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';
import { closeExportDialog, useExportDialog } from './exportStore';
import { FORMATS } from './registry';
import type { ExportScope } from './scope';
import { POSITION_LABEL, readWatermark } from './watermark';
import { WatermarkDialog } from './WatermarkDialog';

// Export Project (1.24, the project menu): a format from the registry, the whole project or one scene, then where it
// goes (the Save dialog for a file, a folder for a set). Exports leave out the Trash. The watermark, when the format
// carries one, is shown here and set in Watermark Settings.

export function ExportHost() {
  const open = useExportDialog();
  const project = useProject((s) => s.project);
  if (!open || !project) return null;
  return open === 'export' ? <ExportDialog key={project.projectId} /> : <WatermarkDialog key={project.projectId} />;
}

/** A modal dialog of the kit: ink rule, no radius, Escape closes. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[520px] max-w-[calc(100vw-32px)] border-[1.5px] border-text bg-surface p-0 text-text backdrop:bg-text/40"
    >
      <div className="flex flex-col gap-4 p-4">
        <h2 id={titleId} className="text-[20px] font-bold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

function ExportDialog() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [formatId, setFormatId] = useState(FORMATS[0]?.id ?? '');
  const [sceneId, setSceneId] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const groupId = useId();
  if (!project) return null;
  const format = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0];
  const scenes = board(records, project.projectId);
  const scene = scenes.find((s) => s.record.id === sceneId) ?? null;
  const scope: ExportScope = scene ? { kind: 'scene', sceneId: scene.record.id } : { kind: 'project' };
  const props = records[project.projectId]?.props;
  const title = typeof props?.title === 'string' && props.title.trim() !== '' ? props.title : project.name;
  const watermark = readWatermark(props);
  const carries = watermark !== null && format?.watermark !== undefined && watermark.appliesTo.includes(format.watermark);
  const frames = (scene ? [scene] : scenes).reduce((n, s) => n + s.shots.length, 0);

  const run = async () => {
    if (!format) return;
    const name = format.name(title, scene?.fields.number ?? null);
    try {
      const target = format.output === 'file' ? await chooseExportFile(name, isTauriApp) : await chooseExportFolder(name, isTauriApp);
      if (!target) return;
      setRunning('Exporting…');
      const what = await format.run({
        records,
        projectId: project.projectId,
        title,
        scope,
        file: project.file,
        target,
        progress: (done, total) => {
          setRunning(`Exporting ${String(done)} of ${String(total)}…`);
        },
      });
      closeExportDialog();
      showInfo(`Exported ${what} to “${target.label}”.`);
    } catch (error) {
      showNotice(error);
    } finally {
      setRunning(null);
    }
  };

  return (
    <Modal title="Export" onClose={() => {
      if (running === null) closeExportDialog();
    }}>
      <div role="radiogroup" aria-labelledby={groupId} className="flex flex-col gap-2">
        <span id={groupId} className="sb-label">
          Format
        </span>
        {FORMATS.map((f) => (
          <div key={f.id} className="flex items-start gap-2 text-[13px]">
            <input
              id={`${groupId}-${f.id}`}
              type="radio"
              name="export-format"
              value={f.id}
              checked={f.id === format?.id}
              aria-describedby={`${groupId}-${f.id}-about`}
              onChange={() => {
                setFormatId(f.id);
              }}
              className="mt-[3px] accent-text"
            />
            <div>
              <label htmlFor={`${groupId}-${f.id}`} className="font-semibold">
                {f.label}
              </label>
              <p id={`${groupId}-${f.id}-about`} className="text-[12px] text-text-muted">
                {f.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      <Select
        label="Scenes"
        value={sceneId}
        onChange={(event) => {
          setSceneId(event.currentTarget.value);
        }}
      >
        <option value="">Whole project</option>
        {scenes.map((s) => (
          <option key={s.record.id} value={s.record.id}>
            {`${sceneLabel(s.fields.number)}  ${headingOf(s.fields)}`}
          </option>
        ))}
      </Select>
      <p className="text-[13px]">
        <span className="font-mono">{String(frames)}</span> {frames === 1 ? 'frame' : 'frames'}, leaving out the Trash.{' '}
        {carries ? `Watermark “${watermark.text}”, ${POSITION_LABEL[watermark.position].toLowerCase()}.` : 'No watermark.'}
      </p>
      {running !== null && (
        <p role="status" className="font-mono text-[12px]">
          {running}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={running !== null} onClick={closeExportDialog}>
          Cancel
        </Button>
        <Button variant="primary" disabled={running !== null || frames === 0} onClick={() => void run()}>
          {format?.output === 'folder' ? 'Choose folder…' : 'Save…'}
        </Button>
      </div>
    </Modal>
  );
}
