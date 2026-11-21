// Tests only (7.5 round 2): the server's test build is written to test-results/7.5/dist-test/, never over mcp/dist, and
// from there Node can't find the two packages it reads at run time (they are in mcp/node_modules). Loaded with
// `node --import` before the build, this resolves only those two from mcp/, as the real build's place does; nothing
// else changes.
import { registerHooks } from 'node:module';

const fromMcp = new URL('../package.json', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    return /^(@modelcontextprotocol\/sdk|zod)(\/|$)/.test(specifier) ? next(specifier, { ...context, parentURL: fromMcp }) : next(specifier, context);
  },
});
