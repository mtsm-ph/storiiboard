import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isTauriApp } from '../../app/fileAccess';
import { showInfo, showNotice } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { sceneLabel } from '../../core/model/storyboard';
import { chooseExportFile, chooseExportFolder } from '../../core/storage/exportFiles';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { board } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';
import { closeExportDialog, useExportDialog } from './exportStore';
import { FORMATS } from './registry';
import type { ExportScope } from './scope';
import { POSITION_LABEL, readWatermark } from './watermark';
import { WatermarkDialog } from './WatermarkDialog';

// Export Project (1.24, the project menu): a format from the registry, the whole project or one scene, then where it
// goes (the Save dialog for a file, a folder for a set). Exports leave out the Trash. The watermark, when the format
// carries one, is shown here and set in Watermark Settings. A running export can be stopped; what it wrote stays.

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
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Chromium (so WebView2) closes a modal dialog on a second Escape without a cancel event the page can stop, so a
    // page can't trap people in one. The close event comes either way: without it the store would still think the
    // dialog open, and the project menu couldn't open it again.
    const closed = () => {
      // The event comes a moment after the close. Open again by then (Strict Mode runs this effect twice, closing
      // the dialog in between), it's a close that no longer stands.
      if (!element.open) latest.current();
    };
    element.addEventListener('close', closed);
    if (!element.open) element.showModal();
    return () => {
      // Going because the store said so: no close event back to it, which may have opened another dialog by then.
      element.removeEventListener('close', closed);
      if (element.open) element.close();
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

const CHOOSING = 'Choosing where…';

/**
 * Why an export failed, for the dialog. A set of files says how far it got and where, since what it wrote stays: the
 * person needs to know which frames to find, or to clear, before they try again. Counted in files written, not frames
 * drawn: a PDF draws every frame before it writes its one file, so one that failed had written nothing.
 */
function failureMessage(error: unknown, written: number, total: number, label: string): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (label === '') return `Not exported: ${reason}`;
  if (written === 0) return `Not exported to “${label}”: ${reason}`;
  return `Stopped with ${String(written)} of ${String(total)} written to “${label}”: ${reason}`;
}

function ExportDialog() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [formatId, setFormatId] = useState(FORMATS[0]?.id ?? '');
  const [sceneId, setSceneId] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  // Why the last run failed, said here: the shell's notice sits under the modal's backdrop, inert and unannounced.
  const [failed, setFailed] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);
  // One export at a time. A ref, not state: a second click can land before React re-renders the button disabled
  // (a double click while the native dialog is still on its way), and a second run would take over `stopper`, so
  // Stop would end the wrong one while the other kept writing.
  const busy = useRef(false);
  // The dialog gone for any reason (another project opened in place) stops what it was running.
  useEffect(
    () => () => {
      stopper.current?.abort();
    },
    [],
  );
  // Worked out once per change to the records, not on every render: a PNG export re-renders the dialog after each
  // frame to say how far it got, and on a feature-size board this was a second or more of work per frame, on the
  // main thread, which Stop and Escape had to wait behind. The dialog is modal, so the records hold still meanwhile.
  const projectId = project?.projectId ?? null;
  const scenes = useMemo(() => (projectId === null ? [] : board(records, projectId)), [records, projectId]);
  if (!project) return null;
  const format = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0];
  const scene = scenes.find((s) => s.record.id === sceneId) ?? null;
  const scope: ExportScope = scene ? { kind: 'scene', sceneId: scene.record.id } : { kind: 'project' };
  const props = records[project.projectId]?.props;
  const title = typeof props?.title === 'string' && props.title.trim() !== '' ? props.title : project.name;
  const watermark = readWatermark(props);
  const carries = watermark !== null && format?.watermark !== undefined && watermark.appliesTo.includes(format.watermark);
  const frames = (scene ? [scene] : scenes).reduce((n, s) => n + s.shots.length, 0);

  const stop = () => {
    stopper.current?.abort();
    closeExportDialog();
  };

  const run = async () => {
    if (!format || busy.current) return;
    busy.current = true;
    const name = format.name(title, scene?.fields.number ?? null);
    const controller = new AbortController();
    stopper.current = controller;
    // Files actually written, not frames drawn: the PDF draws every frame before it writes its one file, so a PDF
    // stopped at frame 2 of 2 had written nothing, and saying "2 of 2 written" told people a file was there.
    let written = 0;
    let total = 0;
    let label = '';
    // The button goes disabled from the first click, while the Save or folder dialog is still coming up.
    setRunning(CHOOSING);
    setFailed(null);
    try {
      const chosen = format.output === 'file' ? await chooseExportFile(name, isTauriApp) : await chooseExportFolder(name, isTauriApp);
      if (!chosen || controller.signal.aborted) return;
      label = chosen.label;
      const target = {
        label: chosen.label,
        write: async (file: string, bytes: Uint8Array) => {
          await chosen.write(file, bytes);
          written += 1;
        },
      };
      setRunning('Exporting…');
      const { what, warning } = await format.run({
        records,
        projectId: project.projectId,
        title,
        scope,
        file: project.file,
        target,
        progress: (done, of) => {
          total = of;
          setRunning(`Exporting ${String(done)} of ${String(of)}…`);
        },
        signal: controller.signal,
      });
      closeExportDialog();
      const said = `Exported ${what} to “${target.label}”.`;
      // Something went out short: a warning, so it reads as one and stays until it's dismissed.
      if (warning) showNotice(`${said} ${warning}`);
      else showInfo(said);
    } catch (error) {
      if (controller.signal.aborted) {
        showInfo(
          written === 0 ? 'Export stopped. Nothing was written.' : `Export stopped: ${String(written)} of ${String(total)} written to “${label}”.`,
        );
      } else setFailed(failureMessage(error, written, total, label));
    } finally {
      if (stopper.current === controller) stopper.current = null;
      busy.current = false;
      setRunning(null);
    }
  };

  return (
    <Modal title="Export" onClose={stop}>
      {/* The kit's segmented control, square and ink-filled, rather than the webview's round radio dots. */}
      <SegmentedControl
        label="Format"
        options={FORMATS.map((f) => ({ value: f.id, label: f.label, hint: f.description }))}
        value={format?.id ?? ''}
        onChange={setFormatId}
      />
      {format && <p className="-mt-2 text-[12px] text-text-muted">{format.description}</p>}
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
      {failed !== null && (
        <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {failed}
        </p>
      )}
      {running !== null && (
        <p role="status" className="font-mono text-[12px]">
          {running}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={stop}>{running === null || running === CHOOSING ? 'Cancel' : 'Stop'}</Button>
        <Button variant="primary" disabled={running !== null || frames === 0} onClick={() => void run()}>
          {format?.output === 'folder' ? 'Choose folder…' : 'Save…'}
        </Button>
      </div>
    </Modal>
  );
}
