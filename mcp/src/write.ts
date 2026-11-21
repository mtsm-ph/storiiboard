import type { JsonValue } from '../../src/core/model/record';
import { suggestionsFolder, writeChangeFile, type WriteHooks } from './changeFolder';
import { checkedChangeFile, type Proposal } from './propose';
import type { ToolContext } from './tools';

// A propose tool's last step (7.6): the proposal checked and built as a change file (propose.ts), then the server's one
// write, that file into the project's Suggestions folder (changeFolder.ts). Checked first, so a refused proposal never
// makes the folder.

type Obj = { [key: string]: JsonValue };

export const ARRIVES =
  'Storiiboard brings this file in when the project opens, as one step that can be undone, or offers it when its window comes back to the front. ' +
  'A person applies or rejects each suggestion in the Suggestions tile; nothing changes until then.';

export function writeProposal(context: ToolContext, proposal: Proposal, hooks: WriteHooks = {}): Obj {
  const built = checkedChangeFile(context, proposal);
  const { data } = context;
  const folder = suggestionsFolder(data.path, data.projectId, data.name);
  writeChangeFile(folder.path, built.name, built.bytes, hooks);
  return {
    written: { file: built.name, folder: folder.name, folder_made: folder.made, change_file_id: built.id, suggestions: built.count },
    suggestions: proposal.suggestions.map((s, i) => ({ id: s.id, kind: s.kind, target: s.target.label, says: proposal.lines[i] ?? '' })),
    next: folder.renamed
      ? `${ARRIVES} This folder is named for the project's earlier name: Storiiboard asks to rename it to match before it brings its files in.`
      : ARRIVES,
  };
}
