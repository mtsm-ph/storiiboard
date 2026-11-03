// While a tile or splitter is dragged, no text may be selected. Left on, the drag selects the text it crosses, and
// the next press on selected text starts the browser's own drag, which cancels pointer events mid-move. The class
// sets user-select and Safari's prefixed form (theme.css).

export function holdTextSelection(): void {
  window.getSelection()?.removeAllRanges();
  document.documentElement.classList.add('sb-dragging');
}

export function releaseTextSelection(): void {
  document.documentElement.classList.remove('sb-dragging');
}
