// Small line glyphs from the design kit's title bars and controls. All decorative: the button around them
// carries the label.

export function GripGlyph() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" className="shrink-0 fill-text">
      <circle cx="2" cy="2" r="1.1" />
      <circle cx="6" cy="2" r="1.1" />
      <circle cx="2" cy="6" r="1.1" />
      <circle cx="6" cy="6" r="1.1" />
      <circle cx="2" cy="10" r="1.1" />
      <circle cx="6" cy="10" r="1.1" />
    </svg>
  );
}

export function MaximizeGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
      <path d="M1 4V1h3M7 1h3v3M10 7v3H7M4 10H1V7" fill="none" className="stroke-text" strokeWidth="1.5" />
    </svg>
  );
}

export function RestoreGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
      <path d="M4 1v3H1M7 1v3h3M7 10V7h3M4 10V7H1" fill="none" className="stroke-text" strokeWidth="1.5" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 1l8 8M9 1l-8 8" className="stroke-text" strokeWidth="1.5" />
    </svg>
  );
}

export function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true" className={className}>
      <path d="M1 1l3.5 3.5L8 1" fill="none" className="stroke-text" strokeWidth="1.5" />
    </svg>
  );
}

export function PlayGlyph() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d="M1 1l8 5-8 5z" className="fill-text" />
    </svg>
  );
}

/** The sidebar: a window with its left column, filled while the sidebar shows, an outline while it's hidden. */
export function SidebarGlyph({ shown }: { shown: boolean }) {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
      <rect x="0.75" y="0.75" width="12.5" height="10.5" fill="none" className="stroke-text" strokeWidth="1.5" />
      <rect x="0.75" y="0.75" width="4.5" height="10.5" className={shown ? 'fill-text stroke-text' : 'fill-none stroke-text'} strokeWidth="1.5" />
    </svg>
  );
}

/** History: a clock face whose hand turns back. In the button's own colour, so it mutes with the word when disabled. */
export function HistoryGlyph() {
  return (
    <svg width="13" height="12" viewBox="0 0 13 12" aria-hidden="true" className="shrink-0">
      <path d="M2.4 3.2A5 5 0 1 1 2 7.4" fill="none" className="stroke-current" strokeWidth="1.5" />
      <path d="M1 1.2v2.8h2.8" fill="none" className="stroke-current" strokeWidth="1.5" />
      <path d="M6.7 3.5V6.5l2 1.2" fill="none" className="stroke-current" strokeWidth="1.5" />
    </svg>
  );
}

/** Settings: a gear, in the button's own colour. */
export function GearGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="2.2" fill="none" className="stroke-current" strokeWidth="1.5" />
      <path
        d="M7 0.9v1.8M7 11.3v1.8M0.9 7h1.8M11.3 7h1.8M2.7 2.7l1.3 1.3M10 10l1.3 1.3M2.7 11.3L4 10M10 4l1.3-1.3"
        fill="none"
        className="stroke-current"
        strokeWidth="1.5"
      />
      <circle cx="7" cy="7" r="4.6" fill="none" className="stroke-current" strokeWidth="1.5" />
    </svg>
  );
}

/** Delete to the Trash: a bin, in the button's own colour. */
/** Edit a title in place (Nov 5): a pencil, drawn in 1.5px strokes like the other glyphs. */
export function PencilGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <path d="M1 11l.6-2.9L8.4 1.3a1 1 0 0 1 1.4 0l.9.9a1 1 0 0 1 0 1.4L3.9 10.4L1 11zM7.4 2.3l2.3 2.3" fill="none" className="stroke-current" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashGlyph() {
  return (
    <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true" className="shrink-0">
      <path d="M0.5 2.5h10M4 2.5V1h3v1.5M1.75 2.5l.75 8.75h6l.75-8.75M4.25 5v4.5M6.75 5v4.5" fill="none" className="stroke-current" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * A department's status on a shot (polish 6), each its own shape so colour is never the only cue: Priority a
 * triangle, Seen an eye, Working on it a half-filled circle, Done a checked circle with a soft glow, Approved a
 * diamond. Outlined in the text colour; filled with the status colour (DESIGN.md, Department status).
 */
export function DepartmentStateGlyph({
  state,
  size = 12,
  hollow = false,
}: {
  state: 'priority' | 'seen' | 'working' | 'done' | 'approved';
  size?: number;
  /** Approved by someone else, not by the person looking: the diamond's outline only. */
  hollow?: boolean;
}) {
  const shape = (() => {
    switch (state) {
      case 'priority':
        return <path d="M6 1.25 11 10.75H1Z" className="fill-text stroke-text" strokeWidth="1.5" strokeLinejoin="miter" />;
      case 'seen':
        return (
          <>
            <path d="M0.75 6C2.25 3.25 4 2 6 2s3.75 1.25 5.25 4C9.75 8.75 8 10 6 10S2.25 8.75 0.75 6Z" className="fill-none stroke-text" strokeWidth="1.5" />
            <circle cx="6" cy="6" r="2" className="fill-state-seen stroke-text" strokeWidth="1" />
          </>
        );
      case 'working':
        return (
          <>
            <path d="M6 1.25a4.75 4.75 0 0 0 0 9.5Z" className="fill-state-working" />
            {/* The dividing line in the text colour: the half reads as a half even where mustard is faint. */}
            <path d="M6 1.25v9.5" className="stroke-text" strokeWidth="1.5" />
            <circle cx="6" cy="6" r="4.75" className="fill-none stroke-text" strokeWidth="1.5" />
          </>
        );
      case 'done':
        return (
          <g className="sb-glow-done">
            <circle cx="6" cy="6" r="4.75" className="fill-state-done stroke-text" strokeWidth="1.5" />
            {/* Ink on sage in both themes: paper on sage would be too faint in dark mode. */}
            <path d="M3.75 6.1 5.3 7.6 8.3 4.5" className="fill-none stroke-ink-fixed" strokeWidth="1.5" />
          </g>
        );
      case 'approved':
        return <path d="M6 0.9 11.1 6 6 11.1 0.9 6Z" className={hollow ? 'fill-none stroke-text' : 'fill-text stroke-text'} strokeWidth="1.5" />;
    }
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 overflow-visible">
      {shape}
    </svg>
  );
}

/** Shot numbers locked: a closed padlock. Open, the shackle lifts. */
export function LockGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d={open ? 'M2.5 5V3.5a2.5 2.5 0 0 1 5 0' : 'M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5'} fill="none" className="stroke-text" strokeWidth="1.5" />
      <rect x="0.75" y="5.25" width="8.5" height="6" className={open ? 'fill-none stroke-text' : 'fill-text'} strokeWidth="1.5" />
    </svg>
  );
}
