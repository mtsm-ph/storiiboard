import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The MCP server's lint (7.5 round 2): the repo's eslint and the root's rules for TypeScript, read with mcp's own
// tsconfig.json, so the app's lint (which ignores mcp/) never needs mcp/node_modules. `npm run lint --prefix mcp`.

export default defineConfig(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,js}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  { files: ['eslint.config.js'], extends: [tseslint.configs.disableTypeChecked] },
);
