import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default defineConfig(
  {
    ignores: [
      'dist',
      'src-tauri/target',
      'src-tauri/gen',
      'prototype',
      'Storiiboard Design Kit',
      // Copied from the design kit as-is (the Tailwind preset is the kit's CommonJS file).
      'design',
      'playwright-report',
      'test-results',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.strict],
  },
  // Plain JS outside the TypeScript project (and jsx-a11y ships no types), so type-aware rules only add noise.
  { files: ['eslint.config.js', 'public/**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  // public/ is served as-is to the webview, not bundled: browser globals only, classic script.
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser, sourceType: 'script' } },
);
