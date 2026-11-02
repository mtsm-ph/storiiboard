// Storiiboard Tailwind preset. Colours read the CSS variables in tokens.css,
// so light/dark switches with [data-theme="dark"] on <html>.
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        paper: 'var(--sb-paper)',
        oatmeal: 'var(--sb-oatmeal)',
        panel: 'var(--sb-panel)',
        ink: 'var(--sb-ink)',
        'ink-inverse': 'var(--sb-ink-inverse)',
        muted: 'var(--sb-muted)',
        rule: 'var(--sb-rule)',
        'rule-top': 'var(--sb-rule-top)',
        accent: 'var(--sb-accent)',
        'on-accent': 'var(--sb-on-accent)',
        warning: 'var(--sb-warning)',
        highlight: 'var(--sb-highlight)',
        dept: {
          camera: 'var(--sb-dept-camera)',
          lighting: 'var(--sb-dept-lighting)',
          art: 'var(--sb-dept-art)',
          wardrobe: 'var(--sb-dept-wardrobe)',
          sound: 'var(--sb-dept-sound)',
        },
      },
      fontFamily: {
        ui: ['Inter Tight', 'Inter', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'monospace'],
        display: ['Archivo', 'Arial Black', 'sans-serif'],
        futura: ['Jost', 'Futura', 'sans-serif'],
        rounded: ['Outfit', 'sans-serif'],
        serif: ['Bodoni Moda', 'Didot', 'serif'],
      },
      borderWidth: { rule: '1.5px' },
      borderRadius: { none: '0' },
      spacing: { gap: '8px', titlebar: '26px', topbar: '44px', statusbar: '24px' },
      fontSize: { label: ['10px', { letterSpacing: '0.08em', lineHeight: '1.2' }] },
    },
  },
};
