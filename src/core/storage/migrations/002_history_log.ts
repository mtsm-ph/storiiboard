import type { ProjectFile, Row, Statement } from '../driver';
import type { Migration } from '../migrate';

// Schema v2: an append-only History (Kevin, Nov 2). Undo, redo and restore become op groups of their own in a new
// op_groups table, and ops loses its state column, so no row in the log is ever changed again.
//
// A v1 file marked undone groups in place. The backfill turns each mark into a real undo group, placed where the undo
// must have happened, so the log replays to exactly the records the file holds. It renumbers ops.seq to match, since
// restore and an item's history read ops in that order.

interface V1Group {
  id: string;
  state: string;
  author: string;
  timestamp: string;
}

interface V1Op {
  recordId: string;
  kind: string;
  before: Row[string];
  after: Row[string];
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const groups = (
    await file.query('SELECT group_id, min(seq) AS first, max(state) AS state, author, timestamp FROM ops GROUP BY group_id ORDER BY first')
  ).map((row): V1Group => ({ id: String(row.group_id), state: String(row.state), author: String(row.author), timestamp: String(row.timestamp) }));
  if (groups.length === 0) return [];
  let opSeq = 0;
  let groupSeq = 0;
  const at = now().toISOString();
  // seq is unique, so the old numbers move out of the way first.
  const statements: Statement[] = [{ sql: 'UPDATE ops SET seq = -seq' }];

  const undoStack: V1Group[] = [];
  let redoStack: V1Group[] = [];
  const groupRow = (id: string, kind: string, author: string, timestamp: string, target: string | null, below: string | null) => {
    groupSeq += 1;
    statements.push({
      sql: `INSERT INTO op_groups (id, seq, kind, target_group_id, restore_to, stack_below, undo_top, redo_top, author,
        timestamp, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, groupSeq, kind, target, below, undoStack.at(-1)?.id ?? null, redoStack.at(-1)?.id ?? null, author, timestamp, at, at],
    });
  };
  // v1 marks were final states only: anything not applied above an applied group was undone before that group.
  const undoMarked = async () => {
    while (undoStack.length > 0 && undoStack.at(-1)?.state !== 'applied') {
      const target = undoStack.pop() as V1Group;
      const below = redoStack.at(-1)?.id ?? null;
      redoStack.push(target);
      const id = crypto.randomUUID();
      // When the undo happened isn't known; the migration's time is the honest answer.
      groupRow(id, 'undo', target.author, at, target.id, below);
      const ops = await file.query('SELECT record_id, kind, before, after FROM ops WHERE group_id = ? ORDER BY seq DESC', [target.id]);
      for (const op of ops.map((r): V1Op => ({ recordId: String(r.record_id), kind: String(r.kind), before: r.before ?? null, after: r.after ?? null }))) {
        opSeq += 1;
        statements.push({
          sql: `INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, created_at,
            updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [crypto.randomUUID(), opSeq, id, op.recordId, op.kind, op.after, op.before, target.author, at, at, at],
        });
      }
    }
  };

  for (const group of groups) {
    await undoMarked();
    const below = undoStack.at(-1)?.id ?? null;
    undoStack.push(group);
    redoStack = [];
    groupRow(group.id, 'edit', group.author, group.timestamp, null, below);
    for (const op of await file.query('SELECT id FROM ops WHERE group_id = ? ORDER BY seq', [group.id])) {
      opSeq += 1;
      statements.push({ sql: 'UPDATE ops SET seq = ? WHERE id = ?', params: [opSeq, String(op.id)] });
    }
  }
  await undoMarked();
  // A v1 'discarded' group was undone and then edited over: it isn't redoable, though it stays in the log.
  return statements;
}

export const historyLog: Migration = {
  version: 2,
  description: 'Append-only History: op_groups, and ops without a state',
  statements: [
    {
      // stack_below, undo_top and redo_top thread the undo and redo stacks through the log, so ⌘Z reads two rows
      // instead of replaying every group. They're derived from the log, never edited.
      sql: `CREATE TABLE op_groups (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        target_group_id TEXT REFERENCES op_groups (id),
        restore_to TEXT REFERENCES op_groups (id),
        stack_below TEXT REFERENCES op_groups (id),
        undo_top TEXT REFERENCES op_groups (id),
        redo_top TEXT REFERENCES op_groups (id),
        author TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    },
    { sql: 'CREATE INDEX op_groups_by_target ON op_groups (target_group_id, seq)' },
    { sql: 'ALTER TABLE ops DROP COLUMN state' },
    { sql: "DELETE FROM meta WHERE key = 'undo_cursor'" },
  ],
  backfill,
};
