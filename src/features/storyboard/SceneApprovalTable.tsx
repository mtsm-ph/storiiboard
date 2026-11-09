import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS, type Department } from '../../core/model/department';
import { approvalWho, type Approver } from '../../core/model/departmentStatus';
import { approvalState, approvalsIn, isCurrent, myApproval, type SceneApprovals } from '../../core/model/sceneApprovals';
import { DepartmentStateGlyph } from '../../ui/glyphs';

// A scene's approvals (3.6b): a row per department, each with one Approved box and who gave it. The director or the
// DP ticks their own sign-off; anyone else sees whether it's approved and why they can't tick it. An approval given
// before the scene changed says so, "Changed since approval", in the warning colour and in words, until it's given
// again: ticking a changed one of your own gives it again, now. One Tab stop; the arrows move between rows.

const ROW = 'grid grid-cols-[minmax(0,1fr)_28px] items-center gap-x-2';

interface SceneApprovalTableProps {
  /** "SC 04", for the grid's name. */
  scene: string;
  approvals: SceneApprovals;
  /** What each department touches in the scene now (approvalBasis), to tell a current approval from a changed one. */
  basisOf: (department: Department) => string;
  /** The rows, in order: every department in call-sheet order, or a department's alone in its workspace. */
  departments: readonly Department[];
  /** The roles this person approves in on this project: director, DP, both, or none. */
  myRoles: readonly Approver[];
  /** Their Approved tick on a department: given, taken back, or given again once the scene has changed. */
  onApprove: (department: Department) => void;
  /** The grid's name, when it's one part of a focus view (3.6c). */
  label?: string;
  /** Whether to say who approves, under the grid; once, under the last part shown. */
  note?: boolean;
}

export function SceneApprovalTable({ scene, approvals, basisOf, departments, myRoles, onApprove, label, note = true }: SceneApprovalTableProps) {
  const canApprove = myRoles.length > 0;
  const [at, setAt] = useState(0);
  const table = useRef<HTMLDivElement>(null);
  const base = useId();

  const move = (row: number) => {
    const next = Math.max(0, Math.min(departments.length - 1, row));
    setAt(next);
    table.current?.querySelector<HTMLElement>(`[data-approval-row="${String(next)}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, row: number) => {
    const keys: Record<string, number> = { ArrowUp: row - 1, ArrowDown: row + 1, Home: 0, End: departments.length - 1 };
    const to = keys[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(to);
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={table} role="grid" aria-label={label ?? t('sceneApproval.table', { scene })} className="flex flex-col gap-y-1">
        {departments.map((department, row) => {
          const given = approvalsIn(approvals, department);
          const basis = basisOf(department);
          const state = approvalState(given, basis);
          const mine = myApproval(given, myRoles);
          const mineCurrent = mine !== undefined && isCurrent(mine, basis);
          // For a director or DP the box is their own sign-off: ticked when theirs is current, mixed when only someone
          // else's is, so a click always changes what it says. For anyone else, whether the department is approved.
          const othersCurrent = given.some((a) => a !== mine && isCurrent(a, basis));
          const checked = canApprove ? (mineCurrent ? true : othersCurrent ? 'mixed' : false) : state === 'approved';
          const label = t('departmentStatus.cell', { department: DEPARTMENT_LABELS[department], state: t('departmentState.approved') });
          const describedBy = `${base}-${department}`;
          return (
            <div key={department} role="row" className={ROW}>
              <span role="rowheader" className="flex min-w-0 flex-col text-[12px] leading-tight">
                <span className="break-words">{DEPARTMENT_LABELS[department]}</span>
                <span id={describedBy} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                  {state === 'changed' && (
                    <span data-approval-changed="" className="sb-label bg-warning px-[5px] text-paper-fixed">
                      {t('sceneApproval.changed')}
                    </span>
                  )}
                  {given.map((a, i) => (
                    <span key={i}>{t(isCurrent(a, basis) ? 'departmentStatus.approvedByWho' : 'sceneApproval.approvedBefore', { who: approvalWho(a) })}</span>
                  ))}
                </span>
              </span>
              <span role="gridcell" className="flex justify-center">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={label}
                  aria-describedby={given.length > 0 ? describedBy : undefined}
                  aria-disabled={!canApprove || undefined}
                  title={canApprove ? label : t('departmentStatus.approveWho')}
                  data-approval-row={row}
                  data-approval-department={department}
                  tabIndex={at === row ? 0 : -1}
                  onFocus={() => {
                    setAt(row);
                  }}
                  onKeyDown={(event) => {
                    onKeyDown(event, row);
                  }}
                  onClick={() => {
                    if (canApprove) onApprove(department);
                  }}
                  className={`inline-flex size-[22px] items-center justify-center border-text focus-visible:outline-offset-1 ${canApprove ? 'border' : 'border border-dashed'}`}
                >
                  {state !== 'none' && <DepartmentStateGlyph state="approved" hollow={checked !== true} />}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {!canApprove && note && <p className="text-[12px] text-text-muted">{t('departmentStatus.approveHow')}</p>}
    </div>
  );
}
