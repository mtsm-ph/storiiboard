// The tool strip's icons (6.5.2): every SVG in this folder, bundled at build time as text, one file per tool so Kevin
// can replace one drawing by saving over one file (README.md here). Nothing is fetched: the markup is the app's own.

const sources = import.meta.glob<string>('./*.svg', { eager: true, query: '?raw', import: 'default' });

/** Each icon's SVG markup by its file's name without .svg ("wall", "select"). */
export const TOOL_ICONS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(sources).map(([path, svg]) => [path.replace(/^\.\//, '').replace(/\.svg$/, ''), svg]),
);

/** The icon a tool is drawn with: a host's tool without its `host:` prefix, a board's by its own id. */
export const toolIconName = (id: string): string => id.replace(/^host:/, '');
