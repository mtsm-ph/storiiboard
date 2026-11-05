import { t } from '../../core/i18n';
// The S mark from design/logo. It stands alone: never next to or inside the wordmark.
const S_PATH =
  'M79 33 C75 21 64 14 50 14 C34 14 23 22 23 35 C23 49 37 54 50 57.5 C64 61 78 66 78 82 C78 96 66 105 50 105 C35 105 24 97 21 85';

/** At this size and below the inline and rings turn to mush, so the solid S takes over (DESIGN.md). */
export const SMALL_MARK_MAX = 32;

interface SMarkProps {
  /** Square size in px; the mark is always centred in its square. */
  size?: number;
  /** Colour of whatever sits behind the mark: the inline always matches the background. */
  inline?: string;
  label?: string;
  /** Hide from screen readers when a visible name or heading already says "Storiiboard". */
  decorative?: boolean;
  className?: string;
}

export function SMark({
  size = 32,
  inline = 'var(--bg)',
  label = t('app.name'),
  decorative = false,
  className,
}: SMarkProps) {
  const small = size <= SMALL_MARK_MAX;
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  return (
    <svg width={size} height={size} viewBox="-16 -6.5 132 132" className={className} {...a11y}>
      {/* The dots are always Signal Orange; never recolour them. */}
      {small ? (
        <>
          <path d={S_PATH} fill="none" className="stroke-text" strokeWidth={24} />
          <circle cx={79} cy={33} r={13.5} className="fill-brand" />
          <circle cx={21} cy={85} r={13.5} className="fill-brand" />
        </>
      ) : (
        <>
          <path d={S_PATH} fill="none" className="stroke-text" strokeWidth={22} />
          <circle cx={79} cy={33} r={12.5} className="fill-brand" />
          <circle cx={21} cy={85} r={12.5} className="fill-brand" />
          <path d={S_PATH} fill="none" strokeWidth={2.6} style={{ stroke: inline }} />
          <circle cx={79} cy={33} r={5.6} className="fill-brand" strokeWidth={2.6} style={{ stroke: inline }} />
          <circle cx={21} cy={85} r={5.6} className="fill-brand" strokeWidth={2.6} style={{ stroke: inline }} />
        </>
      )}
    </svg>
  );
}
