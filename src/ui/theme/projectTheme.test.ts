import { describe, expect, it } from 'vitest';
import { themeFor } from './generator/generate';
import { applyTokens, readProjectTheme, themeProp } from './projectTheme';

describe('a project’s stored theme', () => {
  it('reads back exactly what was stored, both modes, with its preferred mode', () => {
    const theme = themeFor('#1E6BD6');
    const prop = themeProp(theme, { source: 'image', mode: 'dark', imageId: 'media-1', candidates: ['#1E6BD6', '#C2185B'] });
    // As the file stores it: snake_case names, and the family's id.
    expect(prop).toMatchObject({ version: 1, source: 'image', image_id: 'media-1', mode: 'dark', family: 'navy', generator: 1 });
    expect((prop.tokens as { light: Record<string, string> }).light.surface_raised).toBe(theme.light.surfaceRaised);
    expect(readProjectTheme(JSON.parse(JSON.stringify(prop)))).toEqual({ mode: 'dark', tokens: { light: theme.light, dark: theme.dark } });
  });

  it('shows the kit’s colours for the default or a theme that isn’t whole, and still keeps its mode', () => {
    expect(readProjectTheme(undefined)).toBeNull();
    expect(readProjectTheme({ source: 'default' })).toBeNull();
    // The kit's own look, in the mode the person chose at onboarding.
    const kit = themeProp(themeFor(null), { source: 'default', mode: 'dark', imageId: null, candidates: [] });
    expect(readProjectTheme(kit)).toEqual({ mode: 'dark', tokens: null });
    const prop = themeProp(themeFor('#2E8B57'), { source: 'manual', mode: 'light', imageId: null, candidates: [] });
    const broken = JSON.parse(JSON.stringify(prop)) as { tokens: { dark: Record<string, string> } };
    broken.tokens.dark.accent = 'orange';
    expect(readProjectTheme(broken)).toEqual({ mode: 'light', tokens: null });
    const partial = JSON.parse(JSON.stringify(prop)) as { tokens: { dark?: unknown } };
    delete partial.tokens.dark;
    expect(readProjectTheme(partial)?.tokens).toBeNull();
    // No mode named: the OS decides.
    const modeless = JSON.parse(JSON.stringify(prop)) as { mode?: unknown };
    modeless.mode = 'sepia';
    expect(readProjectTheme(modeless)?.mode).toBeNull();
  });

  it('never lets a stored colour carry more CSS than a colour', () => {
    const prop = themeProp(themeFor('#2E8B57'), { source: 'manual', mode: 'light', imageId: null, candidates: [] });
    for (const hostile of ['#000000; background: url(https://example.com/x)', 'red', '#00000g', ' #000000', 'var(--x)']) {
      const tampered = JSON.parse(JSON.stringify(prop)) as { tokens: { light: Record<string, string> } };
      tampered.tokens.light.bg = hostile;
      expect(readProjectTheme(tampered)?.tokens, hostile).toBeNull();
    }
  });

  it('sets the ten tokens on an element, and takes them all off again', () => {
    const style = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => style.set(name, value),
        removeProperty: (name: string) => style.delete(name),
      },
    } as unknown as HTMLElement;
    const theme = themeFor('#7A3FB5');
    applyTokens(theme.light, root);
    expect(style.size).toBe(10);
    expect(style.get('--accent')).toBe(theme.light.accent);
    applyTokens(null, root);
    expect(style.size).toBe(0);
  });
});
