import { useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS, type Department } from '../../core/model/department';
import {
  approvalWho,
  approvedByMe,
  DEPARTMENT_STATE_LABELS,
  inState,
  orderedDepartments,
  statusIn,
  withMyApproval,
  withState,
  type Approval,
  type Approver,
  type DepartmentStatuses,
} from '../../core/model/departmentStatus';
import { DepartmentStateGlyph } from '../../ui/glyphs';

// Department status in the inspector (polish 6): a row per department, Priority first, and a box per state. One Tab
// stop for the whole table; the arrows move between boxes and Space ticks, as in a spreadsheet. Approved is the
// director's or the DP's: for anyone else it says why it can't be ticked, rather than hiding. In the inspector, each
// department's name opens its workspace (3.6a): a cell of its own, left of Priority, in the same arrow-key grid.

/** The columns, in order. Seen is automatic (polish 6b): shown, never ticked by hand. */
const COLUMNS = ['priority', 'seen', 'working', 'done', 'approved'] as const;
type Column = (typeof COLUMNS)[number];

/** The department's name, then a 28px column per state. */
const ROW = 'grid grid-cols-[minmax(0,1fr)_repeat(5,28px)] items-center';

interface DepartmentStatusTableProps {
  statuses: DepartmentStatuses;
  /** The departments that have opened this frame (polish 6b). */
  seen: readonly string[];
  /** The approval this person would give, or null when their role on the project doesn't approve. */
  approval: () => Approval | null;
  /** The roles this person approves in on this project: director, DP, both, or none. */
  myRoles: readonly Approver[];
  /**
   * An edit, worked out from the frame's statuses as they are when it lands, not as this render saw them: two quick
   * ticks both stay. Null leaves the frame as it is.
   */
  onEdit: (edit: (now: DepartmentStatuses) => DepartmentStatuses | null) => void;
  /** Opens a department's workspace from its name (3.6a); without it, the names are plain text. */
  onOpen?: (department: Department) => void;
  /** One department's row alone, as its own workspace shows the frame (3.6a). */
  only?: Department;
}

export function DepartmentStatusTable({ statuses, seen, approval, myRoles, onEdit, onOpen, only }: DepartmentStatusTableProps) {
  const canApprove = myRoles.length > 0;
  // The order is fixed while the inspector shows this frame: ticking Priority mustn't move the row away from focus.
  const [order] = useState(() => (only ? [only] : orderedDepartments(statuses)));
  // With names that open a workspace, they're the grid's first column; the states' columns count on after them.
  const offset = onOpen ? 1 : 0;
  const width = COLUMNS.length + offset;
  // The table's Tab stop starts on the first row's Priority, names or not, as it always has.
  const [at, setAt] = useState<{ row: number; col: number }>({ row: 0, col: offset });
  const table = useRef<HTMLDivElement>(null);

  const toggle = (department: Department, column: Column) => {
    if (column === 'seen') return;
    if (column !== 'approved') {
      onEdit((now) => withState(now, department, column, !statusIn(now, department)[column]));
      return;
    }
    if (!canApprove) return;
    // Their own sign-off, with their name and role, or taken back if they gave it; anyone else's stays.
    onEdit((now) => {
      const mine = approval();
      return mine ? withMyApproval(now, department, mine) : null;
    });
  };

  const move = (row: number, col: number) => {
    const next = { row: Math.max(0, Math.min(order.length - 1, row)), col: Math.max(0, Math.min(width - 1, col)) };
    setAt(next);
    table.current?.querySelector<HTMLElement>(`[data-cell="${String(next.row)}-${String(next.col)}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, row: number, col: number) => {
    const keys: Record<string, [number, number]> = {
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
      Home: [row, 0],
      End: [row, width - 1],
    };
    const to = keys[event.key];
    if (!to) return;
    event.preventDefault();
    move(...to);
  };

  const approved = order.flatMap((department) => statusIn(statuses, department).approvals.map((a) => ({ department, a })));

  return (
    <div className="flex flex-col gap-2">
      {/* An ARIA grid, not a table: one Tab stop, the arrows between boxes. Each row its own CSS grid, so every row
          stays in the accessibility tree (older WebKit drops display: contents). */}
      <div ref={table} role="grid" aria-label={t('departmentStatus.table')} className="flex flex-col gap-y-0.5">
        <div role="row" className={ROW}>
          <span role="columnheader" className="sb-label pb-1 text-text-muted">
            {t('departmentStatus.department')}
          </span>
          {COLUMNS.map((column) => (
            <span key={column} role="columnheader" title={DEPARTMENT_STATE_LABELS[column]} className="flex justify-center pb-1">
              <DepartmentStateGlyph state={column} />
              <span className="sr-only">{DEPARTMENT_STATE_LABELS[column]}</span>
            </span>
          ))}
        </div>
        {order.map((department, row) => {
          const status = statusIn(statuses, department);
          return (
            <div key={department} role="row" className={ROW}>
              {/* Wrapped, not cut off: "Maquillaje y peinado" or "Grip & electric" fill two lines of a narrow inspector. */}
              <span role="rowheader" className={`min-w-0 pr-2 text-[12px] leading-tight break-words ${status.priority ? 'font-semibold' : ''}`}>
                {onOpen ? (
                  <button
                    type="button"
                    aria-label={t('departmentStatus.openWorkspace', { department: DEPARTMENT_LABELS[department] })}
                    title={t('departmentStatus.openWorkspace', { department: DEPARTMENT_LABELS[department] })}
                    data-cell={`${String(row)}-0`}
                    data-open-department={department}
                    tabIndex={at.row === row && at.col === 0 ? 0 : -1}
                    onFocus={() => {
                      setAt({ row, col: 0 });
                    }}
                    onKeyDown={(event) => {
                      onKeyDown(event, row, 0);
                    }}
                    onClick={() => {
                      onOpen(department);
                    }}
                    // Reads as the name it was; the underline on hover and focus says it goes somewhere. The cell's full
                    // width, so a long name wraps inside it ("Posproducción" in a narrow inspector) as the plain text did.
                    className="block w-full text-left break-words hover:underline focus-visible:underline focus-visible:outline-offset-1"
                  >
                    {DEPARTMENT_LABELS[department]}
                  </button>
                ) : (
                  DEPARTMENT_LABELS[department]
                )}
              </span>
              {COLUMNS.map((column, index) => {
                const col = index + offset;
                const on = inState(statuses, seen, department, column);
                const off = column === 'approved' && !canApprove;
                const automatic = column === 'seen';
                // For a director or DP, Approved is their own sign-off: ticked when they've given it, mixed when only
                // someone else has, so a click always changes what the box says. For anyone else, whether it's approved.
                const checked = column === 'approved' && canApprove ? (approvedByMe(status, myRoles) ? true : on ? 'mixed' : false) : on;
                const label = t('departmentStatus.cell', { department: DEPARTMENT_LABELS[department], state: DEPARTMENT_STATE_LABELS[column] });
                return (
                  <span key={column} role="gridcell" className="flex justify-center">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={label}
                      aria-disabled={off || undefined}
                      aria-readonly={automatic || undefined}
                      title={off ? t('departmentStatus.approveWho') : automatic ? t('departmentStatus.seenHow') : label}
                      data-cell={`${String(row)}-${String(col)}`}
                      tabIndex={at.row === row && at.col === col ? 0 : -1}
                      onFocus={() => {
                        setAt({ row, col });
                      }}
                      onKeyDown={(event) => {
                        onKeyDown(event, row, col);
                      }}
                      onClick={() => {
                        toggle(department, column);
                      }}
                      className={`inline-flex size-[22px] items-center justify-center border-text focus-visible:outline-offset-1 ${off ? 'border border-dashed' : automatic ? 'border border-dotted' : 'border'}`}
                    >
                      {on && <DepartmentStateGlyph state={column} hollow={checked === 'mixed'} />}
                    </button>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      {approved.length > 0 && (
        <ul aria-label={t('departmentStatus.approvals')} className="flex flex-col gap-0.5 text-[12px]">
          {approved.map(({ department, a }, i) => (
            <li key={`${department}-${String(i)}`} className="flex items-center gap-1.5">
              <DepartmentStateGlyph state="approved" size={10} />
              {t('departmentStatus.approvedBy', { department: DEPARTMENT_LABELS[department], who: approvalWho(a) })}
            </li>
          ))}
        </ul>
      )}
      {/* The columns in words, for anyone who doesn't know the shapes yet. */}
      <ul aria-label={t('departmentStatus.legend')} className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
        {COLUMNS.map((column) => (
          <li key={column} className="flex items-center gap-1">
            <DepartmentStateGlyph state={column} size={10} />
            {DEPARTMENT_STATE_LABELS[column]}
          </li>
        ))}
      </ul>
      {!canApprove && <p className="text-[12px] text-text-muted">{t('departmentStatus.approveHow')}</p>}
    </div>
  );
}
