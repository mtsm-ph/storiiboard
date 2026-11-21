import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
// The files that take pictures dropped from the system in the browser build, each with where the desktop app's path is:
// one list, read here and by src/app/noHtmlDrag.test.ts, the text scan beside this rule (6.15 review).
import OS_DROP_FILES from './src/app/osDropFiles.json' with { type: 'json' };

// No HTML5 drag and drop in the app (6.15, docs/DESKTOP_GAPS.md B1; CLAUDE.md: lists reorder by pointer events). The
// desktop window keeps Tauri's file drop on (`dragDropEnabled`, for pictures dropped from Explorer or Finder), and on
// Windows that turns HTML5 drag and drop off inside the page: a drag started in the app never moves, and only a browser
// would show it working. Konva's own `draggable` (react-konva's capitalised components) is pointer events, so the JSX
// checks look only at lowercase, DOM, elements. Shapes a selector can't see (props spread from an object, a component
// that forwards `draggable`, createElement, a computed name) are caught by src/app/noHtmlDrag.test.ts, which reads src
// as text.
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
  // Not Konva's own drag events (KonvaEventObject<DragEvent>, react-konva's pointer-event dragging): those are no HTML5.
  "Identifier[name=/^(DragEvent|DragEventHandler)$/]:not(TSTypeReference[typeName.name='KonvaEventObject'] > TSTypeParameterInstantiation > TSTypeReference > Identifier)",
].map((selector) => ({ selector, message: DND_RECEIVE }));
/**
 * In OS_DROP_FILES: dataTransfer is read only as files, items and types (and dropEffect set), never kept, passed on or
 * taken apart (`dt = event.dataTransfer`, `take(event.dataTransfer)`, `{ dt: event.dataTransfer }`, `event['dataTransfer']`).
 */
const TRANSFER = "MemberExpression[property.name='dataTransfer']";
const DROP_READS = [
  `MemberExpression[property.name!=/^(files|items|types|dropEffect)$/] > ${TRANSFER}.object`,
  `MemberExpression[computed=true] > ${TRANSFER}.object`,
  "MemberExpression[computed=true][property.value='dataTransfer']",
  `VariableDeclarator > ${TRANSFER}.init`,
  `AssignmentExpression > ${TRANSFER}.right`,
  `:matches(CallExpression, NewExpression) > ${TRANSFER}.arguments`,
  `:matches(Property, ArrayExpression, SpreadElement, ReturnStatement, ArrowFunctionExpression, LogicalExpression, ConditionalExpression, TSAsExpression) > ${TRANSFER}`,
  `:matches(VariableDeclarator, AssignmentExpression, CallExpression, NewExpression, Property, ArrayExpression, ReturnStatement, ArrowFunctionExpression) > ChainExpression > ${TRANSFER}`,
  "ObjectPattern > Property[key.name='dataTransfer']",
].map((selector) => ({ selector, message: DND_RECEIVE }));

export default defineConfig(
  {
    ignores: [
      'dist',
      // The MCP server's build (npm run build --prefix mcp).
      'mcp/dist',
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
