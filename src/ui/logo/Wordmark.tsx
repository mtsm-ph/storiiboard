import { WORDMARK_LETTERS, WORDMARK_VIEWBOX } from './wordmarkPaths';
import { t } from '../../core/i18n';

const [, , VIEW_WIDTH = 1, VIEW_HEIGHT = 1] = WORDMARK_VIEWBOX.split(' ').map(Number);

interface WordmarkProps {
  /** Rendered height in px; the width follows the wordmark's proportions. */
  height?: number;
  label?: string;
  className?: string;
}

/**
 * STORIIBOARD in outlined Inter Tight 900. The letters take the theme's ink, so one component covers paper and
 * dark. Use it wherever the name must be read; it is never combined with the S mark.
 */
export function Wordmark({ height = 24, label = t('app.name'), className }: WordmarkProps) {
  return (
    <svg
      height={height}
      width={(height * VIEW_WIDTH) / VIEW_HEIGHT}
      viewBox={WORDMARK_VIEWBOX}
      role="img"
      aria-label={label}
      className={className}
    >
      {WORDMARK_LETTERS.map((d, i) => (
        // A fixed list of letters, so the position is a stable key.
        <path key={i} d={d} className="fill-text" />
      ))}
      {/* The two I's: orange bars, each with a round dot above. Fixed colours in every theme. */}
      <rect x={273.57} y={-72.75} width={20} height={72.75} className="fill-brand" />
      <circle cx={283.57} cy={-94.25} r={11.5} className="fill-brand" />
      <rect x={298.57} y={-72.75} width={20} height={72.75} className="fill-brand" />
      <circle cx={308.57} cy={-94.25} r={11.5} className="fill-brand" />
    </svg>
  );
}
