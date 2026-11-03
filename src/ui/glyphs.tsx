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

/** Shot numbers locked: a closed padlock. Open, the shackle lifts. */
export function LockGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d={open ? 'M2.5 5V3.5a2.5 2.5 0 0 1 5 0' : 'M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5'} fill="none" className="stroke-text" strokeWidth="1.5" />
      <rect x="0.75" y="5.25" width="8.5" height="6" className={open ? 'fill-none stroke-text' : 'fill-text'} strokeWidth="1.5" />
    </svg>
  );
}
