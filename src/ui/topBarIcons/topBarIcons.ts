// The top bar's icons (item 8: Undo and Redo), one SVG file per icon, bundled at build time as text, as the tool
// strip's are (src/ui/canvas/toolIcons): a drawing is replaced by saving over its file. Each is on a 32 × 32 grid in a
// 1.5 px stroke of `currentColor`, with no <title> (the button's own name is what people hear), so it draws in the
// bar's ink on paper and in paper in Dark. Nothing is fetched: the markup is the app's own.

const sources = import.meta.glob<string>('./*.svg', { eager: true, query: '?raw', import: 'default' });

/** Each icon's SVG markup by its file's name without .svg ("undo", "redo"). */
export const TOP_BAR_ICONS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(sources).map(([path, svg]) => [path.replace(/^\.\//, '').replace(/\.svg$/, ''), svg]),
);
