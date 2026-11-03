import { DEPARTMENT_LABELS, type Department } from '../core/model/department';
import { SHOT_STATUS_LABELS, type ShotStatus } from '../core/model/shotStatus';
import { cx } from './cx';

// Department colours are labels only, never state (DESIGN.md). Text colour is fixed per tag, so it holds in
// both themes: paper on navy and rust, ink on mustard, sage and blush.
// The 1.5px rule on outline tags comes out of the padding, so both kinds stand the same height.
const FILLED = 'px-[7px] py-1';
const OUTLINE = 'border border-text px-[5.5px] py-[2.5px] text-text';

const DEPARTMENT_TAG: Record<Department, string> = {
  // Navy all but vanishes on the dark panel (1.2:1), so dark mode edges it in paper, as the kit's dark boards do.
  camera: `${FILLED} bg-dept-camera text-paper-fixed dark:outline dark:outline-paper-fixed`,
  'grip-electric': `${FILLED} bg-dept-lighting text-ink-fixed`,
  art: `${FILLED} bg-dept-art text-ink-fixed`,
  wardrobe: `${FILLED} bg-dept-wardrobe text-ink-fixed`,
  hmu: `${FILLED} bg-dept-wardrobe text-ink-fixed`,
  cast: `${FILLED} bg-dept-wardrobe text-ink-fixed`,
  sound: `${FILLED} bg-dept-sound text-paper-fixed`,
  production: `${FILLED} bg-dept-sound text-paper-fixed`,
  // The kit gives these three no colour; an outline reads as "uncoloured" in both themes.
  direction: OUTLINE,
  post: OUTLINE,
  client: OUTLINE,
};

export function departmentTagClass(department: Department): string {
  return DEPARTMENT_TAG[department];
}

interface DepartmentTagProps {
  department: Department;
  /** Overrides the standard name, e.g. "Lighting" for grip & electric. */
  label?: string;
}

export function DepartmentTag({ department, label }: DepartmentTagProps) {
  return (
    <span className={cx('sb-label inline-block', DEPARTMENT_TAG[department])}>
      {label ?? DEPARTMENT_LABELS[department]}
    </span>
  );
}

// Shape, not colour, carries shot status: it reads in both themes, in print and for colour-blind crew.
const STATUS_SHAPE: Record<ShotStatus, string> = {
  have: 'bg-text',
  need: '',
  source: 'bg-[linear-gradient(135deg,var(--text)_50%,transparent_50%)]',
};

interface StatusGlyphProps {
  status: ShotStatus;
  /** Show the status name beside the square; otherwise the square carries it as its accessible name. */
  showLabel?: boolean;
}

export function StatusGlyph({ status, showLabel = false }: StatusGlyphProps) {
  const name = SHOT_STATUS_LABELS[status];
  const square = cx('inline-block size-[9px] shrink-0 border border-text', STATUS_SHAPE[status]);
  if (!showLabel) return <span role="img" aria-label={name} className={square} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={square} />
      <span className="sb-label">{name}</span>
    </span>
  );
}

/** Golden hour on Burning Flame with ink text; the time is mono like every technical value. */
export function GoldenHourChip({ time }: { time: string }) {
  return <span className="sb-label inline-block bg-highlight px-[7px] py-1 text-ink-fixed">Golden hr {time}</span>;
}

/** Conflicts on Truffle with paper text. The ▲ keeps the warning readable without colour. */
export function ConflictChip({ children }: { children: string }) {
  return (
    <span className="sb-label inline-block bg-warning px-[7px] py-1 text-paper-fixed">
      <span aria-hidden="true">▲ </span>Conflict — {children}
    </span>
  );
}
