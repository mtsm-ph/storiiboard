import { useId } from 'react';
import { useProject } from '../../app/projectStore';
import { useWorkspaceId } from '../../app/shell/workspaceContext';
import { departmentOf } from '../../app/shell/workspaces';
import { approvalNow, signatureOf, useMyPart, useProjectSelf } from '../../app/settings/projectRole';
import { list, t, tn } from '../../core/i18n';
import { DEPARTMENT_LABELS, DEPARTMENTS, isDepartment } from '../../core/model/department';
import { approverRoles, DEPARTMENT_STATE_LABELS } from '../../core/model/departmentStatus';
import { ROLE_LABELS } from '../../core/model/role';
import { aspectRatioValue, projectStoryboard, sceneFields, sceneLabel, specLine } from '../../core/model/storyboard';
import { cx } from '../../ui/cx';
import { Select } from '../../ui/fields';
import { DepartmentStateGlyph } from '../../ui/glyphs';
import { StatusGlyph } from '../../ui/tags';
import { DepartmentStatusTable } from '../storyboard/DepartmentStatusTable';
import { SceneApprovalTable } from '../storyboard/SceneApprovalTable';
import { approveSceneDepartment } from '../storyboard/sceneApprovalEdit';
import { approvalBasis, sceneApprovals } from '../../core/model/sceneApprovals';
import { editDepartmentStatus } from '../storyboard/departmentEdit';
import { FrameImage } from '../storyboard/FrameImage';
import { pictureView } from '../storyboard/framePictures';
import { ProjectPictures } from '../storyboard/ProjectPictures';
import { headingOf } from '../storyboard/ScenesView';
import { useSelection } from '../storyboard/selection';
import { departmentCounts, departmentFrames, departmentPeople } from './departmentView';
import { pickDepartment, usePickedDepartment } from './openDepartment';

// A department's view of the frame and the scene (3.6a), the heart of its workspace: the frame picked on the board,
// with this department's row to tick; the scene's frames, each with where this department is on it; and who in Cast
// and crew is in it (names and titles; contacts stay in Cast and crew). The scene and frame are the Storyboard's own
// selection, so picking a frame here picks it there. Opened into another workspace from the Layout menu, it has a
// department picker, starting on your own department.

export function DepartmentTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const seen = useProject((s) => s.seen);
  const sceneId = useSelection((s) => s.sceneId);
  const shotId = useSelection((s) => s.shotId);
  const selectShot = useSelection((s) => s.selectShot);
  const fixed = departmentOf(useWorkspaceId());
  const picked = usePickedDepartment();
  const { role, person: me, departments: mine } = useMyPart(project?.projectId);
  const self = useProjectSelf(project?.projectId);
  const base = useId();
  const department = fixed ?? picked ?? mine[0] ?? DEPARTMENTS[0];
  const name = DEPARTMENT_LABELS[department];

  if (!project) return <p className="sb-label p-3 text-text-muted">{t('people.noProject')}</p>;
  const scene = sceneId ? records[sceneId] : undefined;
  const live = scene?.type === 'scene' && scene.trashedAt === null ? scene : undefined;
  const frames = departmentFrames(records, live?.id ?? null, department, seen);
  const frame = frames.find((f) => f.shot.record.id === shotId) ?? null;
  const people = departmentPeople(records, project.projectId, department);
  const aspect = aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio);
  const picture = frame ? pictureView(records, frame.shot.fields) : null;
  const counts = departmentCounts(frames);

  return (
    <ProjectPictures>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* Focus lands here when the workspace opens from a frame's row, so the keyboard starts in the view. */}
            <h2 tabIndex={-1} data-department-view={department} className="text-[18px] leading-tight font-bold focus-visible:outline-offset-2">
              {name}
            </h2>
            <p className="text-[13px]">
              {live ? (
                <>
                  <span className="font-mono">{sceneLabel(sceneFields(live.props).number)}</span> {headingOf(sceneFields(live.props))}
                </>
              ) : (
                <span className="text-text-muted">{t('departmentView.pickScene')}</span>
              )}
            </p>
          </div>
          {fixed === null && (
            <div className="w-48">
              <Select
                label={t('departmentView.pick')}
                value={department}
                onChange={(event) => {
                  if (isDepartment(event.target.value)) pickDepartment(event.target.value);
                }}
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_LABELS[d]}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </header>

        <section aria-labelledby={`${base}-frame`} className="flex flex-col gap-2">
          <h3 id={`${base}-frame`} className="sb-label border-b-[1.5px] border-border pb-1">
            {t('departmentView.thisFrame')}
          </h3>
          {frame ? (
            <>
              <div className="flex flex-wrap items-start gap-3">
                <div className="relative w-full max-w-[320px] shrink-0 overflow-hidden border-[1.5px] border-text bg-surface" style={{ aspectRatio: aspect }}>
                  {picture ? (
                    <FrameImage picture={picture} frameAspect={aspect} eager />
                  ) : (
                    <span className="sb-label absolute inset-0 flex items-center justify-center text-text-muted">{t('departmentView.noPicture')}</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13px]">
                  <p className="flex items-center gap-2">
                    <StatusGlyph status={frame.shot.fields.status} />
                    <span className="font-mono font-bold">{frame.shot.fields.number}</span>
                    {frame.shot.fields.title && <span data-user-text="" className="font-semibold">{frame.shot.fields.title}</span>}
                  </p>
                  {specLine(frame.shot.fields) && <p className="font-mono text-[12px]">{specLine(frame.shot.fields)}</p>}
                  {frame.shot.fields.action && <p data-user-text="">{frame.shot.fields.action}</p>}
                </div>
              </div>
              {/* Keyed by frame and department, as the inspector keys its table: a fresh Tab stop for each. As wide as
                  the inspector's, so the boxes sit beside the name rather than across the tile. */}
              <div className="max-w-[360px]">
              <DepartmentStatusTable
                key={`${frame.shot.record.id}-${department}`}
                only={department}
                statuses={frame.shot.fields.departmentStatus}
                seen={seen[frame.shot.record.id] ?? []}
                onEdit={(edit) => {
                  editDepartmentStatus(frame.shot.record.id, edit);
                }}
              />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-text-muted">{live ? t('departmentView.pickFrame') : t('departmentView.pickScene')}</p>
          )}
        </section>

        {live && (
          <section aria-labelledby={`${base}-scene`} className="flex flex-col gap-2">
            <h3 id={`${base}-scene`} className="sb-label border-b-[1.5px] border-border pb-1">
              {t('departmentView.thisScene')}
            </h3>
            {/* The department's approval of the whole scene (3.6b), as the inspector gives it, this department's row alone. */}
            <div className="max-w-[360px]">
              <SceneApprovalTable
                key={`${live.id}-${department}`}
                scene={sceneLabel(sceneFields(live.props).number)}
                approvals={sceneApprovals(live.props)}
                basisOf={(d) => approvalBasis(records, live.id, d)}
                departments={[department]}
                myRoles={approverRoles(role)}
                onApprove={(d) => {
                  approveSceneDepartment(live.id, d, () => approvalNow(role, new Date(), signatureOf(me)));
                }}
              />
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              <span className="font-mono">{tn('departmentView.frames', frames.length)}</span>
              {counts.map(({ state, count }) => (
                <span key={state} className="flex items-center gap-1">
                  <DepartmentStateGlyph state={state} size={10} />
                  {t('departmentView.stateCount', { count, state: DEPARTMENT_STATE_LABELS[state] })}
                </span>
              ))}
            </p>
            {frames.length === 0 ? (
              <p className="text-[13px] text-text-muted">{t('departmentView.noFrames')}</p>
            ) : (
              <ul aria-label={t('departmentView.frameList', { department: name })} className="flex flex-col">
                {frames.map(({ shot, states }) => {
                  const current = shot.record.id === frame?.shot.record.id;
                  const said = states.map((state) => DEPARTMENT_STATE_LABELS[state]);
                  return (
                    <li key={shot.record.id}>
                      <button
                        type="button"
                        data-department-frame={shot.record.id}
                        aria-current={current || undefined}
                        onClick={() => {
                          selectShot(shot.record.id, live.id);
                        }}
                        // The selected frame takes the accent marker, with its bold number and title as the second cue.
                        className={cx(
                          'flex w-full items-center gap-2 border-l-4 py-1 pr-2 pl-2 text-left text-[13px] hover:bg-surface-raised focus-visible:-outline-offset-2',
                          current ? 'border-accent font-bold' : 'border-transparent',
                        )}
                      >
                        <StatusGlyph status={shot.fields.status} />
                        <span className="w-10 shrink-0 font-mono">{shot.fields.number}</span>
                        <span data-user-text="" className="min-w-0 flex-1 truncate">
                          {shot.fields.title || specLine(shot.fields)}
                        </span>
                        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
                          {states.map((state) => (
                            <DepartmentStateGlyph key={state} state={state} size={10} />
                          ))}
                        </span>
                        <span className="sr-only">{said.length > 0 ? `, ${list(said)}` : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby={`${base}-people`} className="flex flex-col gap-1">
          <h3 id={`${base}-people`} className="sb-label border-b-[1.5px] border-border pb-1">
            {t('departmentView.people')}
          </h3>
          {people.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('departmentView.noPeople', { department: name })}</p>
          ) : (
            <ul className="flex flex-col">
              {people.map(({ record, fields }) => {
                const what = fields.title.trim() || (fields.role ? ROLE_LABELS[fields.role] : '');
                return (
                  <li key={record.id} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[13px]">
                    <span data-user-text="" className="font-semibold">
                      {fields.name || t('people.unnamed')}
                    </span>
                    {what && <span className="text-text-muted">{what}</span>}
                    {record.id === self && (
                      <span className="sb-label font-mono">
                        <span className="sr-only">, </span>
                        {t('people.you')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ProjectPictures>
  );
}
