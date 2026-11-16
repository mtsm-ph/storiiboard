import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../core/i18n';
import { PLAN_TOOLS } from '../../../features/birdseye/plan/planScale';
import { boardStripTools, hostStripTools, type StripTool } from '../stripTools';
import { TOOL_ICONS } from './toolIcons';

// Every tool either host shows in its strip (6.5.2) has its own icon file here and a name in English and Spanish; every
// file here is a tool's, drawn on the kit's grid, and listed in the README.

const folder = new URL('./', import.meta.url);
const files = readdirSync(folder).filter((name) => name.endsWith('.svg'));
const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

/** Each host's buttons, and the options a button opens, as the strip shows them. */
function everyTool(): { host: string; tool: Pick<StripTool, 'id' | 'name' | 'icon'> }[] {
  const pick = () => undefined;
  const board = boardStripTools('select', pick, true);
  const plan = hostStripTools(PLAN_TOOLS, 'select', pick);
  return [
    ...board.flatMap((tool) => [{ host: 'board', tool }, ...(tool.options ?? []).map((option) => ({ host: 'board', tool: option }))]),
    ...plan.map((tool) => ({ host: 'plan', tool })),
  ];
}

afterEach(() => {
  setLocale('en');
});

describe('the tool strip’s icons', () => {
  it('has an icon file for every tool of the board and the plan', () => {
    for (const { host, tool } of everyTool()) {
      expect(files, `${host}: ${tool.id}`).toContain(`${tool.icon}.svg`);
      expect(TOOL_ICONS[tool.icon], `${host}: ${tool.id}`).toMatch(/^<svg /);
    }
  });

  it('names every tool in English and in Spanish', () => {
    setLocale('en');
    const english = everyTool().map(({ tool }) => tool.name);
    setLocale('es');
    const spanish = everyTool().map(({ tool }) => tool.name);
    expect(english.every((name) => name.trim() !== '')).toBe(true);
    expect(spanish.every((name) => name.trim() !== '')).toBe(true);
    expect(english).toContain('Wall');
    expect(spanish).toContain('Muro');
    expect(spanish).toContain('Mano');
  });

  it('copies the kit’s own drawing for each tool the README marks as the kit’s', () => {
    // The kit's ink and the current colour read as one, and the kit's title is left out (README.md).
    const plain = (svg: string) => svg.replace(/<title>[^<]*<\/title>/, '').replaceAll('#16150F', 'INK').replaceAll('currentColor', 'INK').trim();
    const kit = [...readme.matchAll(/^\| ([a-z-]+\.svg) \| .+ \| kit: ([a-z-]+\/[a-z0-9-]+\.svg) \|$/gm)];
    expect(kit.map((row) => row[1])).toEqual(['wall.svg', 'door.svg', 'window.svg', 'camera.svg', 'light.svg', 'mark.svg', 'measure.svg']);
    for (const [, file = '', source = ''] of kit) {
      const original = readFileSync(new URL(`../../icons/plan/${source}`, import.meta.url), 'utf8');
      expect(plain(TOOL_ICONS[file.replace(/\.svg$/, '')] ?? ''), file).toBe(plain(original));
    }
  });

  it('keeps no file no tool uses', () => {
    const used = new Set(everyTool().map(({ tool }) => `${tool.icon}.svg`));
    expect(files.filter((file) => !used.has(file))).toEqual([]);
  });

  it('draws each on the kit’s 32 px grid, in a 1.5 px stroke of the current colour, with no title of its own', () => {
    for (const file of files) {
      const svg = TOOL_ICONS[file.replace(/\.svg$/, '')] ?? '';
      expect(svg, file).toContain('viewBox="0 0 32 32"');
      expect(svg, file).toContain('stroke="currentColor"');
      expect(svg, file).toContain('stroke-width="1.5"');
      expect(svg, file).not.toContain('<title>');
      // The kit's ink is the current colour everywhere but on a kit fill (letters on a department colour).
      expect(svg.replace(/<text [^>]*fill="#16150F"/g, ''), file).not.toContain('#16150F');
    }
  });

  it('lists every file in the README, as the kit’s or drawn here', () => {
    for (const file of files) expect(readme, file).toMatch(new RegExp(`^\\| ${file.replace('.', '\\.')} \\| .+ \\| (kit: [a-z-]+/[a-z0-9-]+\\.svg|drawn here) \\|$`, 'm'));
  });
});
