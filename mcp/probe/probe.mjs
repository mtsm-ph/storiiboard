// Kevin's probe (Phase 7 answer 1; docs/MCP.md, "The probe"): which Node runs an MCP server inside Claude Desktop, and
// does its node:sqlite open a file read-only? One tool, `node_check`. It needs no package, so it packs into a bundle
// (.mcpb) with manifest.json alone and runs on the Node Claude Desktop brings: the MCP's few messages it needs (stdio,
// one JSON message a line) are answered here by hand, the way the SDK would.
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// An error by its codes only, never its message (a message can name a path): node:sqlite's SQLite code, else Node's.
const codeOf = (error) => {
  if (error && typeof error === 'object') {
    if (typeof error.errcode === 'number') return `SQLite ${String(error.errcode)}`;
    if (typeof error.code === 'string') return error.code;
  }
  return 'unknown';
};

function nodeCheck() {
  // The server needs Node 22.16 or later: setReturnArrays and columns on a statement came in 22.16 (docs/MCP.md).
  const check = { node: process.version, electron: process.versions.electron ?? null, sqlite: 'not loaded', set_return_arrays: null, columns: null, read_only_option: null };
  let folder = null;
  let path = null;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    // A small file in a fresh folder of the system's temp space: made once, opened read-only, then deleted with it.
    folder = mkdtempSync(join(tmpdir(), 'storiiboard-probe-'));
    path = join(folder, 'probe.sqlite');
    const make = new DatabaseSync(path);
    make.exec('CREATE TABLE t (x)');
    make.close();
    const db = new DatabaseSync(path, { readOnly: true });
    const statement = db.prepare('SELECT sqlite_version() AS v');
    check.set_return_arrays = typeof statement.setReturnArrays;
    check.columns = typeof statement.columns;
    check.sqlite = `opened read-only, SQLite ${String(statement.get().v)}`;
    // Whether the readOnly option holds: a write on this connection must be refused.
    try {
      db.exec('INSERT INTO t VALUES (1)');
      check.read_only_option = 'ignored: a write went through';
    } catch (error) {
      check.read_only_option = `honoured: a write is refused (${codeOf(error)})`;
    }
    db.close();
  } catch (error) {
    check.sqlite = `failed: ${codeOf(error)}`;
  } finally {
    try {
      if (path) unlinkSync(path);
      if (folder) rmdirSync(folder);
    } catch {
      // Left in the temp folder, which the system empties.
    }
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
