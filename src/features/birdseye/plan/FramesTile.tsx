import { memo, useRef, useState } from 'react';
import { useProject } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import type { SbdRecord } from '../../../core/model/record';
import { cx } from '../../../ui/cx';
import { Select } from '../../../ui/fields';
import { useScrollLane } from '../../../ui/scrollLane';
import { showShot } from '../../moodboards/liveActions';
import { FrameImage } from '../../storyboard/FrameImage';
import { ProjectPictures } from '../../storyboard/ProjectPictures';
import { useLocale } from '../../../ui/useLocale';
import { framesReadingKeeper, type FramesReading } from './framesReading';
import { revealLayersOf } from './layersStore';
import { assignFrame, showFrame } from './planActions';
import { viewKey } from './planItems';
import { planStore, usePlan } from './planStore';
import { useLiveView } from './PlanTile';

// The Frames tile (6.4), under the plan in the Setup workspace: the shown setup's frames in board order, each with its
// picture, shot number, size and lens, read live from the board, and which of the setup's cameras shoots it (or none).
// Pressing a frame makes it its camera's shown frame (the one whose lens the cone draws) and selects that camera on
// the plan; another button opens the frame on the storyboard. Each change is one edit.

type Records = Readonly<Record<string, SbdRecord>>;

const ACTION = 'sb-label h-6 border border-text px-1.5 hover:bg-surface-raised focus-visible:-outline-offset-4';

export function FramesTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const live = useLiveView(records);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('plan.noProject')}</p>;
  if (!live?.setup || live.number === null) {
    return (
      <p className="p-3 text-[13px] text-text-muted" data-frames-tile="" data-frames-state="noSetup">
        {t('frames.pick')}
      </p>
    );
  }
  return (
    <ProjectPictures>
      <FramesOfSetup records={records} projectId={project.projectId} sceneId={live.view.sceneId} setup={live.setup} number={live.number} />
    </ProjectPictures>
  );
}

function FramesOfSetup({ records, projectId, sceneId, setup, number }: { records: Records; projectId: string; sceneId: string; setup: SbdRecord; number: number }) {
  const key = viewKey(sceneId, setup.id);
  const selected = usePlan((s) => s.selections[key]);
  // Read once per edit, and kept as it was while it reads the same (6.11): an edit the tile doesn't show draws nothing here.
  const [keepReading] = useState(framesReadingKeeper);
  const reading = keepReading(records, projectId, setup, number);
  if (reading.rows.length === 0) {
    return (
      <p className="p-3 text-[13px] text-text-muted" data-frames-tile="" data-frames-state="noFrames">
        {t('frames.none', { setup: reading.name })}
      </p>
    );
  }
  return <FrameList reading={reading} selected={selected} planKey={key} />;
}

const FrameList = memo(function FrameList({ reading, selected, planKey: key }: { reading: FramesReading; selected: readonly string[] | undefined; planKey: string }) {
  // Kept from drawing again by its reading, so its own words follow the language through this.
  useLocale();
  const { name, aspect, cameras, rows } = reading;
  const titles = new Map(cameras.map((c) => [c.id, c.title]));
  const scroller = useRef<HTMLElement>(null);
  useScrollLane(scroller);
  return (
    <section ref={scroller} className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-frames-tile="" data-frames-state="ready" aria-label={t('frames.listOf', { setup: name })}>
      {cameras.length === 0 && <p className="text-[12px] text-text-muted" data-frames-no-cameras="">{t('frames.noCameras')}</p>}
      <ul className="flex flex-wrap gap-2">
        {rows.map((shot) => {
          const { picture, holder, spec } = shot;
          const isShown = shot.shown;
          const current = holder !== null && (selected ?? []).includes(holder) && isShown;
          return (
            <li key={shot.id} data-frames-frame={shot.id} data-frames-camera={holder ?? ''} data-frames-shown={isShown ? 'true' : undefined} className="flex w-36 flex-col border border-border">
              {/* With no camera there is no lens to show: still in the Tab order, so the frame is read, but disabled, saying why. */}
              <button
                type="button"
                data-frames-pick={shot.id}
                aria-current={current || undefined}
                aria-disabled={holder === null || undefined}
                onClick={() => {
                  if (holder === null) return;
                  void showFrame(holder, shot.id);
                  // Taken to its camera, which is shown: its layer shown and unlocked first (6.8 review, M1).
                  revealLayersOf([holder]);
                  planStore.getState().select(key, [holder]);
                }}
                className={cx(
                  'flex flex-col items-stretch text-left focus-visible:-outline-offset-2',
                  current ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                  holder === null && 'cursor-default',
                )}
              >
                <span className="relative flex w-full items-center justify-center border-b border-border" style={{ aspectRatio: String(aspect) }}>
                  {picture ? (
                    <FrameImage picture={picture} frameAspect={aspect} />
                  ) : (
                    // Muted text never sits on the ink of the frame pressed (AA): there it takes the fill's paper.
                    <span aria-hidden="true" className={cx('sb-label', !current && 'text-text-muted')}>
                      {t('storyboardView.noImage')}
                    </span>
                  )}
                </span>
                <span className="flex items-baseline gap-1.5 px-1.5 pt-1">
                  <span className="font-mono text-[12px] font-bold">{shot.number}</span>
                  {spec !== '' && <span className="min-w-0 truncate font-mono text-[11px]">{spec}</span>}
                </span>
                {isShown && <span className="sb-label px-1.5">{t('frames.shown')}</span>}
                {/* Its name starts with what it shows (label-in-name), then says what pressing it does. */}
                <span className="sr-only">
                  {', '}
                  {holder ? t('frames.pickNamed', { camera: titles.get(holder) ?? '' }) : t('frames.pickUnlinked')}
                </span>
              </button>
              <div className="flex flex-col gap-1 p-1.5">
                <Select
                  label={t('frames.camera')}
                  mono
                  value={holder ?? ''}
                  disabled={cameras.length === 0}
                  aria-label={t('frames.cameraOf', { frame: shot.number })}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    void assignFrame(shot.id, next === '' ? null : next);
                  }}
                >
                  <option value="">{t('frames.noCamera')}</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
                <button type="button" className={ACTION} data-frames-open={shot.id} aria-label={t('frames.openNamed', { frame: shot.number })} onClick={() => {
                    showShot(shot.id, shot.parentId);
                  }}>
                  {t('frames.open')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
