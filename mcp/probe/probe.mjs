// Kevin's probe (Phase 7 answer 1; docs/MCP.md, "The probe"): which Node runs an MCP server inside Claude Desktop, and
// does its node:sqlite open a file read-only? One tool, `node_check`. It needs no package, so it packs into a bundle
// (.mcpb) with manifest.json alone and runs on the Node Claude Desktop brings: the MCP's few messages it needs (stdio,
// one JSON message a line) are answered here by hand, the way the SDK would.
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

function nodeCheck() {
  const check = { node: process.version, electron: process.versions.electron ?? null, sqlite: 'not loaded' };
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    // A small file in the system's temp folder: made once, then opened read-only.
    const path = join(tmpdir(), 'storiiboard-probe.sqlite');
    new DatabaseSync(path).close();
    const db = new DatabaseSync(path, { readOnly: true });
    check.sqlite = `opened read-only, SQLite ${String(db.prepare('SELECT sqlite_version() AS v').get().v)}`;
    db.close();
  } catch (error) {
    check.sqlite = `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return check;
}

const TOOL = { name: 'node_check', description: "This server's Node version and whether node:sqlite opens a file read-only.", inputSchema: { type: 'object', properties: {} } };
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  // A notification has no id and gets no answer.
  if (message.id === undefined) return;
  const { id, method, params } = message;
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'storiiboard-probe', version: '0.1.0' } } });
  } else if (method === 'tools/list') {
    send({ id, result: { tools: [TOOL] } });
  } else if (method === 'tools/call' && params?.name === TOOL.name) {
    send({ id, result: { content: [{ type: 'text', text: JSON.stringify(nodeCheck()) }] } });
  } else if (method === 'ping') {
    send({ id, result: {} });
  } else {
    send({ id, error: { code: -32601, message: `Not something this probe does: ${String(method)}` } });
  }
});
