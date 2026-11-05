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

/** Shot numbers locked: a closed padlock. Open, the shackle lifts. */
export function LockGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d={open ? 'M2.5 5V3.5a2.5 2.5 0 0 1 5 0' : 'M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5'} fill="none" className="stroke-text" strokeWidth="1.5" />
      <rect x="0.75" y="5.25" width="8.5" height="6" className={open ? 'fill-none stroke-text' : 'fill-text'} strokeWidth="1.5" />
    </svg>
  );
}
