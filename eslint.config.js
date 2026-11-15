import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// No HTML5 drag and drop in the app (6.15, docs/DESKTOP_GAPS.md B1; CLAUDE.md: lists reorder by pointer events). The
// desktop window keeps Tauri's file drop on (`dragDropEnabled`, for pictures dropped from Explorer or Finder), and on
// Windows that turns HTML5 drag and drop off inside the page: a drag started in the app never moves, and only a browser
// would show it working. Konva's own `draggable` (react-konva's capitalised components) is pointer events, so the JSX
// checks look only at lowercase, DOM, elements.
const DND = "HTML5 drag and drop is off inside the Windows app (Tauri's file drop): use pointer events (src/ui/useRowDrag.ts)";
const DND_RECEIVE = `${DND}. Files dropped from the system are taken in the browser build only, in a file eslint.config.js's OS_DROP_FILES lists beside its Tauri path`;
const DOM = "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^[a-z]/]";
/** A drag that starts inside the page: never, anywhere. `draggable={false}` (the browser's own image drag off) is fine. */
const DRAG_STARTS = [
  `${DOM} > JSXAttribute[name.name='draggable']:not([value.expression.raw='false'])`,
  `${DOM} > JSXAttribute[name.name=/^onDrag(Start|End|Exit)?(Capture)?$/]`,
  "CallExpression[callee.property.name=/^(add|remove)EventListener$/][arguments.0.value=/^drag(start|end|exit)?$/]",
  "CallExpression[callee.property.name='setAttribute'][arguments.0.value='draggable']",
  "AssignmentExpression > MemberExpression.left[property.name=/^(draggable|ondrag(start|end|exit)?)$/]",
  "MemberExpression[property.name=/^(setData|setDragImage|clearData|effectAllowed)$/] > MemberExpression.object[property.name='dataTransfer']",
].map((selector) => ({ selector, message: DND }));
/** Receiving a drop: only in OS_DROP_FILES. */
const DROP_RECEIVES = [
  `${DOM} > JSXAttribute[name.name=/^on(DragOver|DragEnter|DragLeave|Drop)(Capture)?$/]`,
  "CallExpression[callee.property.name=/^(add|remove)EventListener$/][arguments.0.value=/^(dragover|dragenter|dragleave|drop)$/]",
  "AssignmentExpression > MemberExpression.left[property.name=/^(ondragover|ondragenter|ondragleave|ondrop)$/]",
  "MemberExpression[property.name='dataTransfer']",
  "Identifier[name=/^(DragEvent|DragEventHandler)$/]",
].map((selector) => ({ selector, message: DND_RECEIVE }));
/** In OS_DROP_FILES: dataTransfer is read only as files, items and types (and dropEffect set), never kept or taken apart. */
const DROP_READS = [
  "MemberExpression[property.name!=/^(files|items|types|dropEffect)$/] > MemberExpression.object[property.name='dataTransfer']",
  "VariableDeclarator > MemberExpression.init[property.name='dataTransfer']",
  "ObjectPattern > Property[key.name='dataTransfer']",
].map((selector) => ({ selector, message: DND_RECEIVE }));
/** Files that take pictures dropped from the system in the browser build, each with where the desktop app's path is. */
const OS_DROP_FILES = {
  'src/app/theme/ThemeImageWell.tsx': 'onWindowDrop (src/app/pictures.ts) in the same file',
  'src/app/theme/OnboardingDialog.tsx': "the ThemeImageWell inside it, whose onWindowDrop takes any drop while the dialog is open",
  'src/features/birdseye/plan/PlanTile.tsx': 'onWindowDrop in the same file',
  'src/features/storyboard/useBoardDrops.ts': 'onWindowDrag and onWindowDrop in the same hook',
  'src/features/moodboards/BoardView.tsx': 'onWindowDrop in the same file',
};

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
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...DRAG_STARTS, ...DROP_RECEIVES] },
  },
  { files: Object.keys(OS_DROP_FILES), rules: { 'no-restricted-syntax': ['error', ...DRAG_STARTS, ...DROP_READS] } },
  // Plain JS outside the TypeScript project (and jsx-a11y ships no types), so type-aware rules only add noise.
  { files: ['eslint.config.js', 'public/**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  // public/ is served as-is to the webview, not bundled: browser globals only, classic script.
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser, sourceType: 'script' } },
);
