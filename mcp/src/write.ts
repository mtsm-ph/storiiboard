import { viewText } from '../../src/core/model/assistantView';
import type { JsonValue } from '../../src/core/model/record';
import { checkRoom, FolderRefused, removeLeftovers, suggestionsFolder, takeAwayMade, writeChangeFile, type SuggestionsFolder, type WriteHooks } from './changeFolder';
import { checkedChangeFile, type Proposal } from './propose';
import { ToolError, type ToolContext } from './tools';

// A propose tool's last step (7.6): the proposal checked and built as a change file (propose.ts), then the server's one
// write, that file into the project's Suggestions folder (changeFolder.ts). Checked first, so a refused proposal never
// makes the folder. Round 2: the answer says what was written by counts and by labels made from the project's own
// records, through the view's text rule, never a value the assistant gave and never the file's path; and anything that
// goes wrong in the write is said in words (a folder made for it taken away again), never as an unreadable project.

type Obj = { [key: string]: JsonValue };

export const ARRIVES =
  'Storiiboard brings this file in when the project opens, as one step that can be undone, or offers it when its window comes back to the front. ' +
  'A person applies or rejects each suggestion in the Suggestions tile; nothing changes until then.';

const NOT_WRITTEN = 'The change file couldn’t be written: nothing was written.';

export function writeProposal(context: ToolContext, proposal: Proposal, hooks: WriteHooks = {}): Obj {
  const built = checkedChangeFile(context, proposal);
  const { data } = context;
  let folder: SuggestionsFolder;
  try {
    folder = suggestionsFolder(data.path, data.projectId, data.name);
  } catch (error) {
    throw error instanceof FolderRefused || error instanceof ToolError ? error : new FolderRefused(NOT_WRITTEN);
  }
  try {
    if (!folder.made) {
      removeLeftovers(folder);
      checkRoom(folder);
    }
    writeChangeFile(folder, built.name, built.bytes, hooks);
  } catch (error) {
    // A folder this call made goes again, with its marker, so a failed write leaves nothing.
    takeAwayMade(folder);
    throw error instanceof FolderRefused ? error : new FolderRefused(NOT_WRITTEN);
  }
  return viewText({
    written: { folder: folder.name, folder_made: folder.made, change_file_id: built.id, suggestions: built.count },
    suggestions: proposal.suggestions.map((s, i) => ({ id: s.id, kind: s.kind, target: s.target.label, says: proposal.lines[i] ?? '' })),
    next: folder.renamed
      ? `${ARRIVES} This folder is named for the project's earlier name: Storiiboard asks to rename it to match before it brings its files in.`
      : ARRIVES,
  }) as Obj;
}
