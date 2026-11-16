// A panel hanging over a canvas (a colour panel from a board's Properties band) keeps clear of the tools' strip
// (6.5.2 round 2): the strip's buttons stay pressable while the panel is open. Where the panel would cover a strip, its
// left edge moves to the strip's right edge plus a gap, as far right as needed.

/** The gap between a strip's right edge and a panel moved clear of it, px. */
export const STRIP_GAP = 8;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The panel's left edge, moved right of any strip its box would meet (strips given as screen boxes). */
export function leftClearOf(panel: Box, strips: readonly Box[]): number {
  let left = panel.left;
  const width = panel.right - panel.left;
  // A strip passed may put the panel over another further right: look again until none is met.
  for (let moved = true; moved; ) {
    moved = false;
    for (const strip of strips) {
      const meets = panel.top < strip.bottom && panel.bottom > strip.top && left < strip.right + STRIP_GAP && left + width > strip.left;
      if (meets) {
        left = strip.right + STRIP_GAP;
        moved = true;
      }
    }
  }
  return left;
}

/** Whether a window point is over a tool strip (a drag released there is not on its canvas). */
export function pointOnStrip(x: number, y: number): boolean {
  return [...document.querySelectorAll<HTMLElement>('[data-tool-strip]')].some((strip) => {
    const box = strip.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  });
}

/** The left edge a panel showing at `panel` takes to keep clear of every tool strip on the page. */
export function leftClearOfStrips(panel: Box): number {
  const strips = [...document.querySelectorAll<HTMLElement>('[data-tool-strip]')].map((strip) => strip.getBoundingClientRect());
  return leftClearOf(panel, strips);
}
