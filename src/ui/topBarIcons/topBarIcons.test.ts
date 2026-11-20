import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOP_BAR_ICONS, TOP_BAR_ICON_NAMES } from './topBarIcons';

// Every icon the top bar draws (item 8: Undo and Redo) has its own file here, drawn as the README says, and is listed
// there; a missing file fails here rather than drawing an empty button.

const folder = new URL('./', import.meta.url);
const files = readdirSync(folder).filter((name) => name.endsWith('.svg'));
const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

describe('the top bar’s icons', () => {
  it('has a file for every icon the bar uses, and none it doesn’t', () => {
    for (const name of TOP_BAR_ICON_NAMES) {
      expect(files, name).toContain(`${name}.svg`);
      expect(TOP_BAR_ICONS[name], name).toMatch(/^<svg /);
    }
    expect(files.filter((file) => !(TOP_BAR_ICON_NAMES as readonly string[]).includes(file.replace(/\.svg$/, '')))).toEqual([]);
  });

  it('draws each on a 32 px grid, in a 1.5 px stroke of the current colour that keeps its width at any size, with no title', () => {
    for (const name of TOP_BAR_ICON_NAMES) {
      const svg = TOP_BAR_ICONS[name] ?? '';
      expect(svg, name).toContain('viewBox="0 0 32 32"');
      expect(svg, name).toContain('stroke="currentColor"');
      expect(svg, name).toContain('stroke-width="1.5"');
      expect(svg, name).not.toContain('<title>');
      expect(svg, name).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
      // Every shape, since vector-effect isn't inherited.
      const shapes = [...svg.matchAll(/<(path|line|polyline|polygon|rect|circle|ellipse)\b[^>]*>/g)].map((m) => m[0]);
      expect(shapes.length, name).toBeGreaterThan(0);
      for (const shape of shapes) expect(shape, name).toContain('vector-effect="non-scaling-stroke"');
    }
  });

  it('lists every file in the README', () => {
    for (const file of files) expect(readme, file).toMatch(new RegExp(`^\\| ${file.replace('.', '\\.')} \\| .+ \\| drawn here \\|$`, 'm'));
  });
});
