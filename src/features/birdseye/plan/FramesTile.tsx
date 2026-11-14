import { useProject } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import { cameraTitle, frameCamera, setupCameras, shownFrame } from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { setupFrames, setupLabel } from '../../../core/model/setup';
import { aspectRatioValue, projectStoryboard, SHOT_SIZE_LABEL, shotFields } from '../../../core/model/storyboard';
import { cx } from '../../../ui/cx';
import { Select } from '../../../ui/fields';
import { showShot } from '../../moodboards/liveActions';
import { FrameImage } from '../../storyboard/FrameImage';
import { pictureView } from '../../storyboard/framePictures';
import { ProjectPictures } from '../../storyboard/ProjectPictures';
import { iconLabel } from './iconWords';
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
  const frames = setupFrames(records, setup.id);
  const cameras = setupCameras(records, setup.id);
  const aspect = aspectRatioValue(projectStoryboard(records[projectId]?.props).aspectRatio);
  const name = setupLabel({ number, fields: { name: typeof setup.props.name === 'string' ? setup.props.name.trim() : '' } });
  if (frames.length === 0) {
    return (
      <p className="p-3 text-[13px] text-text-muted" data-frames-tile="" data-frames-state="noFrames">
        {t('frames.none', { setup: name })}
      </p>
    );
  }
  const titles = new Map(cameras.map((c) => [c.record.id, cameraTitle(records, c.record.id, iconLabel)]));
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-frames-tile="" data-frames-state="ready" aria-label={t('frames.listOf', { setup: name })}>
      {cameras.length === 0 && <p className="text-[12px] text-text-muted" data-frames-no-cameras="">{t('frames.noCameras')}</p>}
      <ul className="flex flex-wrap gap-2">
        {frames.map((shot) => {
          const fields = shotFields(shot.props);
          const picture = pictureView(records, fields);
          const holder = frameCamera(records, shot.id);
          const isShown = holder !== null && shownFrame(records, holder)?.id === shot.id;
          const current = holder !== null && (selected ?? []).includes(holder) && isShown;
          const spec = [fields.size ? SHOT_SIZE_LABEL[fields.size] : null, fields.lensMm === null ? null : t('lens.prime', { mm: fields.lensMm })].filter((p) => p !== null).join(' · ');
          return (
            <li key={shot.id} data-frames-frame={shot.id} data-frames-camera={holder ?? ''} data-frames-shown={isShown ? 'true' : undefined} className="flex w-36 flex-col border border-border">
              <button
                type="button"
                data-frames-pick={shot.id}
                aria-current={current || undefined}
                onClick={() => {
                  if (holder === null) return;
                  void showFrame(holder, shot.id);
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
                  <span className="font-mono text-[12px] font-bold">{fields.number}</span>
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
                  aria-label={t('frames.cameraOf', { frame: fields.number })}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    void assignFrame(shot.id, next === '' ? null : next);
                  }}
                >
                  <option value="">{t('frames.noCamera')}</option>
                  {cameras.map((c) => (
                    <option key={c.record.id} value={c.record.id}>
                      {titles.get(c.record.id)}
                    </option>
                  ))}
                </Select>
                <button type="button" className={ACTION} data-frames-open={shot.id} aria-label={t('frames.openNamed', { frame: fields.number })} onClick={() => {
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
}
