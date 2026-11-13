import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { isTauriApp } from '../../app/fileAccess';
import { showInfo, showNotice } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { sceneLabel } from '../../core/model/storyboard';
import { chooseExportFile, chooseExportFolder, type ExportTarget } from '../../core/storage/exportFiles';
import { Button } from '../../ui/Button';
import { InAppWindow } from '../../ui/InAppWindow';
import { NoticeBar } from '../../app/NoticeBar';
import { Select, Toggle } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { board } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';
import { boardTitle } from '../moodboards/boards';
import { isDeck, pagesOf } from '../moodboards/pages';
import { closeExportDialog, useExportDeck, useExportDialog } from './exportStore';
import { DECK_FORMATS, FORMATS } from './registry';
import type { ExportScope } from './scope';
import { POSITION_LABEL, readWatermark } from './watermark';
import { WatermarkDialog } from './WatermarkDialog';
import { localizeError, pluralKey, t } from '../../core/i18n';
import { Trans } from '../../ui/Trans';

// Export Project (1.24, the project menu): a format from the registry, the whole project or one scene, then where it
// goes (the Save dialog for a file, a folder for a set). Exports leave out the Trash, but for Project data (JSON),
// which is the project itself (2.9). The watermark, when the format carries one, is shown here and set in Watermark
// Settings. A running export can be stopped; what it wrote stays.

export function ExportHost() {
  const open = useExportDialog();
  const project = useProject((s) => s.project);
  if (!open || !project) return null;
  return open === 'export' ? <ExportDialog key={project.projectId} /> : <WatermarkDialog key={project.projectId} />;
}

/** Export and Watermark Settings, each in a window of the app's own (polish B). */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <InAppWindow title={title} onClose={onClose}>
      <NoticeBar />
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </InAppWindow>
  );
}

/** The status while the system's Save or folder dialog is open: Cancel still reads Cancel then, not Stop. */
const CHOOSING = 'choosing';

/**
 * Why an export failed, for the dialog. A set of files says how far it got and where, since what it wrote stays: the
 * person needs to know which frames to find, or to clear, before they try again. Counted in files written, not frames
 * drawn: a PDF draws every frame before it writes its one file, so one that failed had written nothing.
 */
function failureMessage(error: unknown, written: number, total: number, label: string): string {
  const reason = localizeError(error instanceof Error ? error.message : String(error));
  if (label === '') return t('export.failed', { reason });
  if (written === 0) return t('export.failedTo', { label, reason });
  return t('export.failedPartway', { written, total, label, reason });
}

function ExportDialog() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  // From a deck's Export button (5.6a) the dialog is for that deck: its own formats, no scenes.
  const deckId = useExportDeck();
  const deckBoard = deckId ? records[deckId] : undefined;
  const deck = deckBoard !== undefined && isDeck(deckBoard) && deckBoard.trashedAt === null ? deckBoard : null;
  const formats = deckId ? DECK_FORMATS : FORMATS;
  const [formatId, setFormatId] = useState(formats[0]?.id ?? '');
  const [pixelRatio, setPixelRatio] = useState<'1' | '2'>('1');
  const [sceneId, setSceneId] = useState('');
  // Remembered on this computer, as last chosen (polish PP).
  const [scenePalettes, setScenePalettes] = useState(() => loadSettings().pdfScenePalettes);
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
  const format = formats.find((f) => f.id === formatId) ?? formats[0];
  const whole = format?.wholeProject === true;
  const scene = whole ? null : (scenes.find((s) => s.record.id === sceneId) ?? null);
  const scope: ExportScope = scene ? { kind: 'scene', sceneId: scene.record.id } : { kind: 'project' };
  const props = records[project.projectId]?.props;
  const projectTitle = typeof props?.title === 'string' && props.title.trim() !== '' ? props.title : project.name;
  // A deck's files are named for the deck.
  const title = deck ? boardTitle(deck) : projectTitle;
  const pageCount = deck ? pagesOf(records, deck.id).length : 0;
  // A deck with no pages has nothing to print: the formats are off, with the reason said.
  const noPages = deckId !== null && pageCount === 0;
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
    let opened: ExportTarget | null = null;
    // The button goes disabled from the first click, while the Save or folder dialog is still coming up.
    setRunning(CHOOSING);
    setFailed(null);
    try {
      const chosen = format.output === 'file' ? await chooseExportFile(name, isTauriApp) : await chooseExportFolder(name, isTauriApp);
      if (!chosen || controller.signal.aborted) return;
      label = chosen.label;
      opened = chosen;
      let staged = 0;
      const target: ExportTarget = {
        // As the folder is named once it is made ("Pitch 2" where "Pitch" was taken).
        get label() {
          return chosen.label;
        },
        write: async (file: string, bytes: Uint8Array) => {
          await chosen.write(file, bytes);
          written += 1;
        },
        // A set that appears whole (5.6a): counted as written only once it has its names.
        ...(chosen.stage && chosen.commit
          ? {
              stage: async (file: string, bytes: Uint8Array) => {
                await chosen.stage?.(file, bytes);
                staged += 1;
              },
              commit: async () => {
                await chosen.commit?.();
                written += staged;
                staged = 0;
              },
              abandon: () => chosen.abandon?.() ?? Promise.resolve(),
            }
          : {}),
      };
      setRunning(t('export.exporting'));
      const { what, warning } = await format.run({
        records,
        projectId: project.projectId,
        title,
        scope,
        ...(deckId ? { deckId } : {}),
        pixelRatio: pixelRatio === '2' ? 2 : 1,
        file: project.file,
        target,
        progress: (done, of, doing) => {
          total = of;
          setRunning(doing ?? t('export.exportingCount', { done, of }));
        },
        signal: controller.signal,
        scenePalettes: format.options?.scenePalettes === true && scenePalettes,
      });
      closeExportDialog();
      const said = t('export.done', { what, label: target.label });
      // Something went out short: a warning, so it reads as one and stays until it's dismissed.
      if (warning) showNotice(t('export.doneWarning', { said, warning }));
      else showInfo(said);
    } catch (error) {
      // A set that was being made is taken away again: the files this run made and the folder it made for them.
      await opened?.abandon?.().catch(() => undefined);
      if (controller.signal.aborted) {
        showInfo(
          written === 0 ? t('export.stoppedNothing') : t('export.stoppedPartway', { written, total, label }),
        );
      } else setFailed(failureMessage(error, written, total, label));
    } finally {
      if (stopper.current === controller) stopper.current = null;
      busy.current = false;
      setRunning(null);
    }
  };

  return (
    <Modal title={t('exportDialog.export')} onClose={stop}>
      {/* The kit's segmented control, square and ink-filled, rather than the webview's round radio dots. */}
      <SegmentedControl
        label={t('exportDialog.format')}
        options={formats.map((f) => ({ value: f.id, label: f.label, hint: f.description }))}
        value={format?.id ?? ''}
        onChange={setFormatId}
      />
      {format && <p className="-mt-2 text-[12px] text-text-muted">{format.description}</p>}
      {format?.options?.scenePalettes && (
        <Toggle
          label={t('exportDialog.scenePalettes')}
          checked={scenePalettes}
          disabled={running !== null}
          onChange={(on) => {
            setScenePalettes(on);
            saveSettings({ pdfScenePalettes: on });
          }}
        />
      )}
      {format?.options?.pixelRatio && (
        <SegmentedControl
          label={t('export.deck.pixelRatio')}
          options={[
            { value: '1', label: t('export.deck.pixelRatio.1') },
            { value: '2', label: t('export.deck.pixelRatio.2') },
          ]}
          value={pixelRatio}
          disabled={running !== null}
          onChange={setPixelRatio}
        />
      )}
      {!whole && !deckId && (
      <Select
        label={t('exportDialog.scenes')}
        value={sceneId}
        onChange={(event) => {
          setSceneId(event.currentTarget.value);
        }}
      >
        <option value="">{t('exportDialog.wholeProject')}</option>
        {scenes.map((s) => (
          <option key={s.record.id} value={s.record.id}>
            {t('export.sceneOption', { scene: sceneLabel(s.fields.number), heading: headingOf(s.fields) })}
          </option>
        ))}
      </Select>
      )}
      {noPages ? (
        <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {t('export.deck.noPages')}
        </p>
      ) : whole ? (
        <p className="text-[13px]">{format.wholeNote ?? t('export.wholeProject')}</p>
      ) : deckId ? (
        <p className="text-[13px]">
          <Trans k={pluralKey('export.deck.pagesNoWorking', pageCount)} parts={{ count: <span className="font-mono">{String(pageCount)}</span> }} />{' '}
          {carries ? t('export.watermark', { text: watermark.text, position: POSITION_LABEL[watermark.position].toLowerCase() }) : t('export.noWatermark')}
        </p>
      ) : (
        <p className="text-[13px]">
          <Trans k={pluralKey('export.framesNoTrash', frames)} parts={{ count: <span className="font-mono">{String(frames)}</span> }} />{' '}
          {carries ? t('export.watermark', { text: watermark.text, position: POSITION_LABEL[watermark.position].toLowerCase() }) : t('export.noWatermark')}
        </p>
      )}
      {failed !== null && (
        <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {failed}
        </p>
      )}
      {running !== null && (
        <p role="status" className="font-mono text-[12px]">
          {running === CHOOSING ? t('export.choosing') : running}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={stop}>{running === null || running === CHOOSING ? t('common.cancel') : t('export.stop')}</Button>
        <Button variant="primary" disabled={running !== null || noPages || (frames === 0 && !whole && !deckId)} onClick={() => void run()}>
          {format?.output === 'folder' ? t('export.chooseFolder') : t('export.save')}
        </Button>
      </div>
    </Modal>
  );
}
