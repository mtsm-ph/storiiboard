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
    expect(readProjectTheme(JSON.parse(JSON.stringify(prop)))).toEqual({ mode: 'dark', light: theme.light, dark: theme.dark });
  });

  it('reads none for the default, a missing prop or one that isn’t a whole theme, so the kit shows', () => {
    expect(readProjectTheme(undefined)).toBeNull();
    expect(readProjectTheme({ source: 'default' })).toBeNull();
    const prop = themeProp(themeFor('#2E8B57'), { source: 'manual', mode: 'light', imageId: null, candidates: [] });
    const broken = JSON.parse(JSON.stringify(prop)) as { tokens: { dark: Record<string, string> } };
    broken.tokens.dark.accent = 'orange';
    expect(readProjectTheme(broken)).toBeNull();
    const partial = JSON.parse(JSON.stringify(prop)) as { tokens: { dark?: unknown } };
    delete partial.tokens.dark;
    expect(readProjectTheme(partial)).toBeNull();
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
