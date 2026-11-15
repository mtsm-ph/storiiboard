import { useRef, type PointerEvent } from 'react';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { isMac } from '../../app/shell/undoShortcuts';
import { t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import {
  addSetup,
  framesWithoutSetup,
  joinSetup,
  leaveSetup,
  moveSetup,
  renameSetup,
  sceneSetups,
  setupFrames,
  setupLabel,
  trashSetup,
  type Setup,
} from '../../core/model/setup';
import { aspectRatioValue, projectStoryboard, sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { cx } from '../../ui/cx';
import { EditableTitle } from '../../ui/EditableTitle';
import { Trans } from '../../ui/Trans';
import { useSetupDrag } from './useSetupDrag';
import { showPlan, useShownPlan } from './plan/shownPlan';
import { scenesOf } from '../../app/shell/sidebar/scenes';
import { headingOf } from '../storyboard/ScenesView';
import { FrameImage } from '../storyboard/FrameImage';
import { pictureView } from '../storyboard/framePictures';
import { ProjectPictures } from '../storyboard/ProjectPictures';

// The Setups tile (6.0), in the Setup workspace: the scenes in board order, each with its setups (Setup 1, Setup 2,
// numbered by their order, never lettered), how many frames each has and their shot numbers. Add a setup, name it in
// place, reorder by dragging its handle (useSetupDrag) or with Up and Down, delete it to the Trash. Picking a setup shows its frames, live from the
// board's records, each with Take out of setup, and the scene's frames in no setup to add. Every change is one edit.

type Records = Readonly<Record<string, SbdRecord>>;

const ACTION = 'sb-label h-6 border border-text px-1.5 hover:bg-surface-raised focus-visible:-outline-offset-4 aria-disabled:border-dashed aria-disabled:text-text-muted aria-disabled:hover:bg-transparent';

const edit = (build: (now: Records) => Change[]) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));

/** Focus, once the tile has drawn again, on the first element `selector` finds, else on what `fallback` finds. */
function focusSoon(selector: string, fallback?: string) {
  requestAnimationFrame(() => {
    (document.querySelector<HTMLElement>(selector) ?? (fallback ? document.querySelector<HTMLElement>(fallback) : null))?.focus();
  });
}

export function SetupsTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  // What the Setup workspace shows (6.2a): the Plan and Selection tiles read it too.
  const shown = useShownPlan();
  const chosen = shown.setupId;
  const { drag, handleProps } = useSetupDrag((id, to) => {
    void edit((now) => moveSetup(now, id, to));
  });
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('setups.noProject')}</p>;
  const projectId = project.projectId;
  const scenes = scenesOf(records, projectId);
  // The setup picked, while it's live: one deleted (or undone away) shows nothing picked.
  const picked = chosen === null ? null : records[chosen];
  const pickedScene = picked?.type === 'setup' && picked.trashedAt === null && picked.parentId ? records[picked.parentId] : undefined;
  const selected = pickedScene && pickedScene.trashedAt === null ? (sceneSetups(records, pickedScene.id).find((s) => s.record.id === chosen) ?? null) : null;

  if (scenes.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('setups.noScenes')}</p>;

  return (
    <ProjectPictures>
      <div className="flex min-h-0 flex-1 flex-col" data-setups-tile="">
        <div aria-label={t('setups.list')} role="group" className="min-h-0 flex-1 overflow-y-auto">
          {scenes.map((scene) => {
            const fields = sceneFields(scene.props);
            const sceneName = sceneLabel(fields.number);
            const setups = sceneSetups(records, scene.id);
            return (
              <section key={scene.id} aria-label={sceneName} data-setups-scene={scene.id} className="border-b border-border">
                <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-[13px]">
                  <span className="shrink-0 font-mono font-bold">{sceneName}</span>
                  {/* Picking the heading shows the scene on the plan with no setup (6.2a): its room and blocking. */}
                  <button
                    type="button"
                    data-setups-scene-pick={scene.id}
                    aria-label={`${sceneName} ${headingOf(fields)}`}
                    aria-current={shown.sceneId === scene.id && chosen === null ? true : undefined}
                    onClick={() => {
                      showPlan(scene.id, null);
                    }}
                    className={cx(
                      'flex min-w-0 flex-1 px-1 text-left focus-visible:-outline-offset-2',
                      shown.sceneId === scene.id && chosen === null ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span data-user-text="" className="min-w-0 flex-1 truncate">
                      {headingOf(fields)}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-add-setup={scene.id}
                    aria-label={t('setups.addIn', { scene: sceneName })}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      void edit((now) => addSetup(now, scene.id, id)).then((made) => {
                        if (!made) return;
                        showPlan(scene.id, id);
                        focusSoon(`[data-setup-select="${CSS.escape(id)}"]`);
                      });
                    }}
                    className={cx(ACTION, 'shrink-0')}
                  >
                    {t('setups.add')}
                  </button>
                </div>
                {setups.length === 0 ? (
                  <p className="px-3 py-2 text-[13px] text-text-muted">{t('setups.none')}</p>
                ) : (
                  <ol aria-label={t('setups.inScene', { scene: sceneName })}>
                    {setups.map((setup, i) => (
                      <SetupRow
                        key={setup.record.id}
                        records={records}
                        setup={setup}
                        sceneName={sceneName}
                        current={setup.record.id === selected?.record.id}
                        last={i === setups.length - 1}
                        dragged={drag?.id === setup.record.id}
                        handle={handleProps(setup.record.id, scene.id)}
                        onPick={() => {
                          showPlan(scene.id, setup.record.id);
                        }}
                        onDeleted={() => {
                          if (chosen === setup.record.id) showPlan(scene.id, null);
                          // The row that takes its place, else the one before, else the scene's Add setup.
                          const next = setups[i + 1] ?? setups[i - 1];
                          focusSoon(next ? `[data-setup-select="${CSS.escape(next.record.id)}"]` : `[data-add-setup="${CSS.escape(scene.id)}"]`);
                        }}
                      />
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
        <div className="flex max-h-[55%] shrink-0 flex-col overflow-y-auto border-t-[1.5px] border-text">
          {selected && pickedScene ? (
            <SetupFrames records={records} projectId={projectId} setup={selected} scene={pickedScene} />
          ) : (
            <p className="p-3 text-[13px] text-text-muted">{t('setups.pick')}</p>
          )}
        </div>
      </div>
      {drag && (
        // Where the dragged setup will land: an ink bar between rows.
        <div
          aria-hidden="true"
          data-setup-drop-bar=""
          className="pointer-events-none fixed z-40 h-[3.5px] bg-text"
          style={{ left: drag.bar.left, top: drag.bar.top, width: drag.bar.width }}
        />
      )}
    </ProjectPictures>
  );
}

/** A setup row's accessible name: "Setup 2, 1 frame: 4A, “Window side”, in SC 04". */
function rowNameOf(setup: Setup, scene: string, count: string, numbers: string): string {
  const parts = { setup: t('setup.label', { number: setup.number }), count, numbers, scene, name: setup.fields.name };
  if (setup.fields.name === '') return t(numbers === '' ? 'setups.rowName' : 'setups.rowNameFrames', parts);
  return t(numbers === '' ? 'setups.rowNameNamed' : 'setups.rowNameNamedFrames', parts);
}

interface SetupRowProps {
  records: Records;
  setup: Setup;
  sceneName: string;
  current: boolean;
  last: boolean;
  /** This row is the one being dragged. */
  dragged: boolean;
  /** The drag handle's pointer handlers (useSetupDrag). */
  handle: { onPointerDown: (event: PointerEvent<HTMLElement>) => void };
  onPick: () => void;
  onDeleted: () => void;
}

function SetupRow({ records, setup, sceneName, current, last, dragged, handle, onPick, onDeleted }: SetupRowProps) {
  const id = setup.record.id;
  const frames = setupFrames(records, id);
  const label = setupLabel(setup);
  const named = { setup: label, scene: sceneName };
  const numbers = frames.map((shot) => shotFields(shot.props).number).join(' ');
  const count = tn('count.frames', frames.length);
  // One name for the whole row, its scene included, so two scenes' Setup 1 never sound the same. It starts with what the
  // row shows, in that order, so the words on screen are the start of its name (label-in-name, WCAG 2.5.3).
  const rowName = rowNameOf(setup, sceneName, count, numbers);
  const first = setup.number === 1;
  const move = (to: number, which: 'up' | 'down') => {
    void edit((now) => moveSetup(now, id, to)).then((written) => {
      // The row moves in the list; the keys stay on the button pressed, or its twin once it can't go further.
      if (written) focusSoon(`[data-setup-move="${which}"][data-for="${CSS.escape(id)}"]:not([aria-disabled="true"])`, `[data-setup-select="${CSS.escape(id)}"]`);
    });
  };
  return (
    <li data-setup-row={id} data-scene={setup.record.parentId ?? ''} className={cx('border-b border-border px-2 py-1.5', dragged && 'border-dashed')}>
      <div className="flex items-stretch gap-1">
        {/* The mouse's way to reorder; Up and Down below are the keyboard's, so the handle is no stop of its own. */}
        <span
          aria-hidden="true"
          data-setup-handle={id}
          title={t('setups.dragHandle')}
          {...handle}
          className="flex w-4 shrink-0 cursor-grab touch-none items-center justify-center font-mono text-[12px] text-text-muted select-none"
        >
          {t('setups.dragMark')}
        </span>
        <button
          type="button"
          data-setup-select={id}
          aria-current={current || undefined}
          aria-label={rowName}
          onClick={onPick}
          // Selection is an ink fill; on it the focus ring is paper (DESIGN.md: never ink on ink).
          className={cx(
            'flex min-w-0 flex-1 flex-col items-start gap-0.5 px-1.5 py-1 text-left focus-visible:-outline-offset-2',
            current ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
          )}
        >
          <span className="text-[13px] font-semibold">
            <Trans k="setup.label" parts={{ number: <span className="font-mono">{setup.number}</span> }} />
          </span>{' '}
          <span className="flex w-full flex-wrap gap-x-2 text-[12px]">
            <span>{count}</span>
            {/* Spaces the layout stands for on screen, so the words read apart, as the row's name has them. */}
            {frames.length > 0 && ' '}
            {frames.length > 0 && <span className="font-mono">{numbers}</span>}
          </span>
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1 px-1.5 text-[13px]">
        <EditableTitle
          value={setup.fields.name}
          shown={setup.fields.name === '' ? <span className="text-text-muted">{t('setups.noName')}</span> : <span data-user-text="">{setup.fields.name}</span>}
          label={t('setups.nameOf', named)}
          className="min-w-0 flex-1"
          inputClassName="w-full"
          onSave={(text) => {
            void edit((now) => renameSetup(now, id, text));
          }}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-1 px-1.5" role="group" aria-label={label}>
        <button
          type="button"
          data-setup-move="up"
          data-for={id}
          aria-disabled={first}
          aria-label={t('setups.moveUp', named)}
          onClick={() => {
            if (!first) move(setup.number - 2, 'up');
          }}
          className={ACTION}
        >
          {t('setups.up')}
        </button>
        <button
          type="button"
          data-setup-move="down"
          data-for={id}
          aria-disabled={last}
          aria-label={t('setups.moveDown', named)}
          onClick={() => {
            if (!last) move(setup.number, 'down');
          }}
          className={ACTION}
        >
          {t('setups.down')}
        </button>
        <button
          type="button"
          data-setup-delete={id}
          aria-label={t('setups.deleteNamed', named)}
          onClick={() => {
            void edit((now) => trashSetup(now, id)).then((written) => {
              if (!written) return;
              showInfo(t('setups.trashed', { ...named, undo: isMac() ? '⌘Z' : 'Ctrl+Z' }), { step: true });
              onDeleted();
            });
          }}
          className={ACTION}
        >
          {t('setups.delete')}
        </button>
      </div>
    </li>
  );
}

/** The picked setup's frames, small pictures with their numbers, and the scene's frames in no setup to add. */
function SetupFrames({ records, projectId, setup, scene }: { records: Records; projectId: string; setup: Setup; scene: SbdRecord }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const label = setupLabel(setup);
  const sceneName = sceneLabel(sceneFields(scene.props).number);
  const frames = setupFrames(records, setup.record.id);
  const free = framesWithoutSetup(records, scene.id);
  const aspect = aspectRatioValue(projectStoryboard(records[projectId]?.props).aspectRatio);
  const frameIds = frames.map((shot) => shot.id);
  const freeIds = free.map((shot) => shot.id);
  /** Focus on the row that took the place of `id` in `ids`, else the one before, else the heading. */
  const focusNext = (ids: readonly string[], id: string, attribute: string) => {
    const at = ids.indexOf(id);
    const next = ids[at + 1] ?? ids[at - 1];
    requestAnimationFrame(() => {
      const row = next ? document.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(next)}"]`) : null;
      (row ?? headingRef.current)?.focus();
    });
  };
  return (
    <section aria-labelledby={`setup-frames-${setup.record.id}`} data-setup-frames={setup.record.id} className="flex flex-col gap-2 p-2">
      <h2 id={`setup-frames-${setup.record.id}`} ref={headingRef} tabIndex={-1} className="text-[14px] leading-tight font-bold focus-visible:outline-offset-2">
        {t('setups.framesIn', { setup: label, scene: sceneName })}
      </h2>
      {frames.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('setups.noFrames')}</p>
      ) : (
        <ul aria-label={t('setups.framesInList', { setup: label })} className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
          {frames.map((shot) => {
            const fields = shotFields(shot.props);
            const picture = pictureView(records, fields);
            return (
              <li key={shot.id} data-setup-frame={shot.id} className="flex flex-col border border-border">
                <span className="relative flex w-full items-center justify-center border-b border-border" style={{ aspectRatio: String(aspect) }}>
                  {picture ? (
                    <FrameImage picture={picture} frameAspect={aspect} />
                  ) : (
                    <span aria-hidden="true" className="sb-label text-text-muted">
                      {t('storyboardView.noImage')}
                    </span>
                  )}
                </span>
                <span className="px-1.5 py-1 font-mono text-[12px] font-bold">{fields.number}</span>
                <button
                  type="button"
                  data-setup-take-out={shot.id}
                  aria-label={t('setups.takeOutNamed', { frame: fields.number, setup: label })}
                  onClick={() => {
                    void edit((now) => leaveSetup(now, [shot.id])).then((written) => {
                      if (written) focusNext(frameIds, shot.id, 'data-setup-take-out');
                    });
                  }}
                  className={cx(ACTION, 'm-1 mt-0')}
                >
                  {t('setups.takeOut')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="sb-label border-b-[1.5px] border-text pb-1">{t('setups.withoutSetup', { scene: sceneName })}</h3>
      {free.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          {Object.values(records).some((r) => r.type === 'shot' && r.parentId === scene.id && r.trashedAt === null)
            ? t('setups.allInSetups', { scene: sceneName })
            : t('setups.sceneNoFrames', { scene: sceneName })}
        </p>
      ) : (
        <ul aria-label={t('setups.withoutSetup', { scene: sceneName })} className="flex flex-wrap gap-1">
          {free.map((shot) => {
            const number = shotFields(shot.props).number;
            return (
              <li key={shot.id}>
                <button
                  type="button"
                  data-setup-add-frame={shot.id}
                  aria-label={t('setups.addFrameNamed', { frame: number, setup: label })}
                  onClick={() => {
                    void edit((now) => joinSetup(now, [shot.id], setup.record.id)).then((written) => {
                      if (written) focusNext(freeIds, shot.id, 'data-setup-add-frame');
                    });
                  }}
                  className={cx(ACTION, 'normal-case')}
                >
                  <Trans k="setups.addFrame" parts={{ frame: <span className="font-mono">{number}</span> }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
