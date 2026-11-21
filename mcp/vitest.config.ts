import { defineConfig } from 'vitest/config';

// The MCP server's tests (7.5 round 2), run on their own with the repo's Vitest: `npm test --prefix mcp`. They drive the
// server with the SDK's client, so they need mcp/node_modules; the app's run (the root's vite.config.ts) leaves them
// out. The JSON report keeps every failed test's name (3.19), beside the app's.

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', 'json'],
    outputFile: { json: '../test-results/mcp-unit.json' },
  },
});
