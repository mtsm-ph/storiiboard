import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// The MCP server's build (7.5): src/core imports without file extensions, as the app's bundler reads it, so the server
// is bundled with the Vite the repo already has (its Rolldown) into one ES module for Node, dist/server.js (git-ignored),
// with nothing new to install. The SDK and zod stay outside the bundle, read from mcp/node_modules at run time; SunCalc
// and src/core go in. `npm run build --prefix mcp` builds; `npm start --prefix mcp -- <project.sbd>` starts it.

export default defineConfig({
  root: import.meta.dirname,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      external: [/^@modelcontextprotocol\/sdk(\/.*)?$/, /^zod(\/.*)?$/, ...builtinModules, /^node:/],
      output: { format: 'es', entryFileNames: 'server.js' },
    },
  },
  ssr: { noExternal: ['suncalc'], target: 'node' },
});
