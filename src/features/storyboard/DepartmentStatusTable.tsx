import { useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS, type Department } from '../../core/model/department';
import { DEPARTMENT_STATE_LABELS, DEPARTMENT_STATES, inState, orderedDepartments, statusIn, withState, type DepartmentStatuses } from '../../core/model/departmentStatus';
import { DepartmentStateGlyph } from '../../ui/glyphs';

// Department status in the inspector (polish 6): a row per department, Priority first, and a box per state. One Tab
// stop for the whole table; the arrows move between boxes and Space ticks, as in a spreadsheet. In the inspector, each
// department's name opens its workspace (3.6a): a cell of its own, left of Priority, in the same arrow-key grid.
// Approved is the scene's since 3.6b (SceneApprovalTable), so a frame's columns end at Done.

/** The columns, in order. Seen is automatic (polish 6b): shown, never ticked by hand. */
const COLUMNS = DEPARTMENT_STATES;
type Column = (typeof COLUMNS)[number];

/** The department's name, then a 28px column per state. */
const ROW = 'grid grid-cols-[minmax(0,1fr)_repeat(4,28px)] items-center';

interface DepartmentStatusTableProps {
  statuses: DepartmentStatuses;
  /** The departments that have opened this frame (polish 6b). */
  seen: readonly string[];
  /**
   * An edit, worked out from the frame's statuses as they are when it lands, not as this render saw them: two quick
   * ticks both stay. Null leaves the frame as it is.
   */
  onEdit: (edit: (now: DepartmentStatuses) => DepartmentStatuses | null) => void;
  /** Opens a department's workspace from its name (3.6a); without it, the names are plain text. */
  onOpen?: (department: Department) => void;
  /** One department's row alone, as its own workspace shows the frame (3.6a). */
  only?: Department;
  /** These departments' rows alone, Priority first among them: one part of a focus view (3.6c). */
  rows?: readonly Department[];
  /** The grid's name, when it isn't the whole frame's ("Your departments on this frame"). */
  label?: string;
  /** The key naming each shape; left out of a part shown above another (3.6c), so it's said once. */
  legend?: boolean;
}

export function DepartmentStatusTable({ statuses, seen, onEdit, onOpen, only, rows, label, legend = true }: DepartmentStatusTableProps) {
  // The order is fixed for as long as the table is drawn, and the inspector draws it anew for each frame and each change
  // of rows (a focus view, 3.6c): ticking Priority mustn't move the row away from focus.
  const [order] = useState(() => (only ? [only] : orderedDepartments(statuses).filter((d) => !rows || rows.includes(d))));
  // With names that open a workspace, they're the grid's first column; the states' columns count on after them.
  const offset = onOpen ? 1 : 0;
  const width = COLUMNS.length + offset;
  // The table's Tab stop starts on the first row's Priority, names or not, as it always has.
  const [at, setAt] = useState<{ row: number; col: number }>({ row: 0, col: offset });
  const table = useRef<HTMLDivElement>(null);

  const toggle = (department: Department, column: Column) => {
    if (column === 'seen') return;
    onEdit((now) => withState(now, department, column, !statusIn(now, department)[column]));
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

  return (
    <div className="flex flex-col gap-2">
      {/* An ARIA grid, not a table: one Tab stop, the arrows between boxes. Each row its own CSS grid, so every row
          stays in the accessibility tree (older WebKit drops display: contents). */}
      <div ref={table} role="grid" aria-label={label ?? t('departmentStatus.table')} className="flex flex-col gap-y-0.5">
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
                const automatic = column === 'seen';
                const label = t('departmentStatus.cell', { department: DEPARTMENT_LABELS[department], state: DEPARTMENT_STATE_LABELS[column] });
                return (
                  <span key={column} role="gridcell" className="flex justify-center">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={label}
                      aria-readonly={automatic || undefined}
                      title={automatic ? t('departmentStatus.seenHow') : label}
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
                      className={`inline-flex size-[22px] items-center justify-center border-text focus-visible:outline-offset-1 ${automatic ? 'border border-dotted' : 'border'}`}
                    >
                      {on && <DepartmentStateGlyph state={column} />}
                    </button>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* The columns in words, for anyone who doesn't know the shapes yet. */}
      {legend && (
        <ul aria-label={t('departmentStatus.legend')} className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
          {COLUMNS.map((column) => (
            <li key={column} className="flex items-center gap-1">
              <DepartmentStateGlyph state={column} size={10} />
              {DEPARTMENT_STATE_LABELS[column]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
