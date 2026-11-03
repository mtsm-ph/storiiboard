import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import tokens from '../../design/tokens/tokens.json';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

interface Preset {
  theme: {
    extend: {
      colors: Record<string, string | Record<string, string>>;
      fontFamily: Record<string, string[]>;
      borderWidth: Record<string, string>;
      borderRadius: Record<string, string>;
      spacing: Record<string, string>;
      fontSize: Record<string, [string, { letterSpacing: string; lineHeight: string }]>;
    };
  };
}

// The kit ships a Tailwind v3 CommonJS preset; the app runs Tailwind v4, so theme.css restates it. Evaluating
// the preset here keeps the two from drifting when the kit is updated.
function loadPreset(): Preset {
  const sandbox = { module: { exports: {} } };
  runInNewContext(read('design/tokens/tailwind.preset.js'), sandbox);
  return sandbox.module.exports as Preset;
}

const tokensCss = read('design/tokens/tokens.css');

/** Where each kit colour lives now. Semantic tokens are what a project theme sets; the rest are fixed. */
const KIT_TO_TOKEN: Record<string, string> = {
  paper: 'bg',
  panel: 'surface',
  oatmeal: 'surface-raised',
  rule: 'border',
  'rule-top': 'border-top',
  ink: 'text',
  muted: 'text-muted',
  'ink-inverse': 'text-inverse',
  'on-accent': 'accent-contrast',
  // The kit's accent is Signal Orange: the logo's fixed brand colour. The theme accent is set on its own.
  accent: 'brand',
  warning: 'warning',
  highlight: 'highlight',
  'dept-camera': 'dept-camera',
  'dept-lighting': 'dept-lighting',
  'dept-art': 'dept-art',
  'dept-wardrobe': 'dept-wardrobe',
  'dept-sound': 'dept-sound',
};

/** Every component and screen source file, tests left out. */
function componentFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(url);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(url.pathname.slice(root.pathname.length));
    }
  };
  walk(new URL('src/', root));
  return out;
}

/** The --sb-* variables one rule of tokens.css sets, by name without the leading dashes. */
function cssVariables(selector: string): Map<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  const block = tokensCss.slice(start, tokensCss.indexOf('}', start));
  return new Map([...block.matchAll(/--(sb-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]));
}

describe('src/ui/theme.css mirrors the kit preset', () => {
  const theme = read('src/ui/theme.css');
  const preset = loadPreset().theme.extend;
  const light = cssVariables(':root');

  it('covers every section of the preset, so a section the kit adds fails here until it is mapped', () => {
    expect(Object.keys(preset).sort()).toEqual(['borderRadius', 'borderWidth', 'colors', 'fontFamily', 'fontSize', 'spacing']);
  });

  it('gives every kit colour a home: a semantic token a project theme can set, or a fixed one', () => {
    for (const [name, value] of Object.entries(preset.colors)) {
      const entries = typeof value === 'string' ? [[name, value]] : Object.entries(value).map(([k, v]) => [`${name}-${k}`, v]);
      for (const [key, variable] of entries) {
        const token = KIT_TO_TOKEN[String(key)];
        // A colour the kit adds fails here until it's placed in one layer or the other.
        expect(token, `kit colour ${String(key)}`).toBeDefined();
        // Semantic: the token reads the kit variable, and the Tailwind colour reads the token.
        const semantic = theme.includes(`--${String(token)}: ${String(variable)};`);
        const classColour = semantic ? `var(--${String(token)})` : String(variable);
        expect(theme, `${String(key)} → ${String(token)}`).toContain(`--color-${String(token)}: ${classColour};`);
      }
    }
  });

  it('sets the default accent to #DF5E27 and keeps the logo on Signal Orange, a fixed brand token', () => {
    expect(theme).toContain('--accent: #df5e27;');
    expect(theme).toContain('--brand: var(--sb-accent);');
    expect(light.get('sb-accent')?.toUpperCase()).toBe('#E0612B');
    for (const logo of ['src/ui/logo/SMark.tsx', 'src/ui/logo/Wordmark.tsx']) {
      expect(read(logo)).not.toContain('accent');
      expect(read(logo)).toContain('fill-brand');
    }
  });

  it('never lets a component paint with the kit names or a hex value', () => {
    const offenders = componentFiles().filter((file) => /var\(--sb-(?!topbar|statusbar|gap|titlebar)|#[0-9a-fA-F]{6}\b/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('reads each font stack from the kit variable that lists the same fonts', () => {
    for (const [key, stack] of Object.entries(preset.fontFamily)) {
      expect(theme).toContain(`--font-${key}: var(--sb-font-${key});`);
      const fonts = (light.get(`sb-font-${key}`) ?? '').split(',').map((font) => font.trim().replace(/^'|'$/g, ''));
      expect(fonts).toEqual(stack);
    }
  });

  it('sizes the layout from the kit variables, at the preset values', () => {
    for (const [key, value] of Object.entries(preset.spacing)) {
      expect(theme).toContain(`--spacing-${key}: var(--sb-${key});`);
      expect(light.get(`sb-${key}`)).toBe(value);
    }
  });

  it('sets each text size with its tracking and leading', () => {
    for (const [key, [size, { letterSpacing, lineHeight }]] of Object.entries(preset.fontSize)) {
      expect(theme).toContain(`--text-${key}: ${size};`);
      expect(theme).toContain(`--text-${key}--letter-spacing: ${letterSpacing};`);
      expect(theme).toContain(`--text-${key}--line-height: ${lineHeight};`);
    }
  });

  it('draws every border at the rule width and rounds nothing', () => {
    expect(light.get('sb-rule-width')).toBe(preset.borderWidth.rule);
    expect(theme).toContain('--default-border-width: var(--sb-rule-width);');
    expect(preset.borderRadius).toEqual({ none: '0' });
    expect(theme).toContain('--radius-*: initial;');
  });
});

// The AA checks below read tokens.json; the app paints with tokens.css. They must hold the same colours.
describe('tokens.json matches tokens.css', () => {
  const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const { color } = tokens;
  const light = cssVariables(':root');
  const dark = cssVariables('[data-theme="dark"]');

  it.each([
    ['light', color.light, light],
    ['dark', color.dark, dark],
  ] as const)('%s surfaces and text', (_theme, json, css) => {
    for (const [name, hex] of Object.entries(json)) expect(css.get(`sb-${kebab(name)}`)?.toUpperCase()).toBe(hex);
  });

  it('accent, supporting and department colours', () => {
    const shared: [string, string][] = [
      ['sb-accent', color.accent],
      ['sb-on-accent', color.onAccent],
      ['sb-warning', color.warning],
      ['sb-highlight', color.highlight],
      ...Object.entries(color.department).map(([name, hex]): [string, string] => [`sb-dept-${name}`, hex]),
    ];
    for (const [variable, hex] of shared) expect(light.get(variable)?.toUpperCase()).toBe(hex);
  });

  it('paper-fixed in theme.css is the light paper', () => {
    expect(read('src/ui/theme.css')).toContain(`--color-paper-fixed: ${color.light.paper.toLowerCase()};`);
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour at some opacity over a background, blended in sRGB as browsers paint it. */
function over(hex: string, alpha: number, background: string): string {
  const channel = (value: string, i: number) => parseInt(value.slice(i, i + 2), 16);
  const mixed = [1, 3, 5].map((i) => Math.round(channel(hex, i) * alpha + channel(background, i) * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const placeholderAlpha = Number(/placeholder:text-text\/(\d+)/.exec(read('src/ui/fields.tsx'))?.[1] ?? 'NaN') / 100;

describe('colour pairs the app uses meet AA (4.5:1)', () => {
  const { light, dark, accent, onAccent, warning, highlight, department } = tokens.color;
  const paper = light.paper;
  const ink = light.ink;
  const pairs: [string, string, string][] = [
    ['light: ink on paper', light.ink, light.paper],
    ['light: muted on paper', light.muted, light.paper],
    ['light: ink on oatmeal', light.ink, light.oatmeal],
    ['light: muted on panel', light.muted, light.panel],
    ['light: warning text on paper', warning, light.paper],
    ['dark: ink on background', dark.ink, dark.paper],
    ['dark: muted on background', dark.muted, dark.paper],
    ['dark: ink on panel', dark.ink, dark.panel],
    ['dark: muted on panel', dark.muted, dark.panel],
    ['dark: ink on oatmeal', dark.ink, dark.oatmeal],
    // TextField placeholders: ink at the opacity fields.tsx sets, on the oatmeal well.
    ['light: placeholder on oatmeal', over(light.ink, placeholderAlpha, light.oatmeal), light.oatmeal],
    ['dark: placeholder on oatmeal', over(dark.ink, placeholderAlpha, dark.oatmeal), dark.oatmeal],
    ['ink on Signal Orange (the kit accent)', onAccent, accent],
    ['ink on the default theme accent', onAccent, '#DF5E27'],
    ['paper on Truffle', paper, warning],
    ['ink on Burning Flame', ink, highlight],
    ['camera tag', paper, department.camera],
    ['lighting tag', ink, department.lighting],
    ['art tag', ink, department.art],
    ['wardrobe tag', ink, department.wardrobe],
    ['sound tag', paper, department.sound],
  ];

  it.each(pairs)('%s', (_name, text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  // These pairs fail, which is why the components avoid them. If the kit changes and they pass, the rules in
  // Tile, Button and TextField can relax.
  it('muted on oatmeal and Truffle on the dark panel still fail', () => {
    expect(contrast(light.muted, light.oatmeal)).toBeLessThan(4.5);
    expect(contrast(dark.muted, dark.oatmeal)).toBeLessThan(4.5);
    expect(contrast(warning, dark.panel)).toBeLessThan(4.5);
  });
});
