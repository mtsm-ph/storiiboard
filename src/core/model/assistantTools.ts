import type { MessageKey } from '../i18n';

// The MCP server's tools (Phase 7 decision 16), one list for both sides of it: the server registers exactly these
// (mcp/test checks its tool list against this one, and docs/MCP.md has a section for each), and Settings → AI assistant
// (7.6, decision 14) lists them with one line each on what it returns or writes, so the words never drift from the tools.
// The app never imports the server; the server imports this.

export type AssistantToolKind = 'read' | 'check' | 'propose';

export interface AssistantTool {
  name: string;
  kind: AssistantToolKind;
  /** One line on what it returns or writes, for Settings. */
  words: MessageKey;
}

export const ASSISTANT_TOOLS = [
  { name: 'project_summary', kind: 'read', words: 'assistant.tool.project_summary' },
  { name: 'list_scenes', kind: 'read', words: 'assistant.tool.list_scenes' },
  { name: 'list_shots', kind: 'read', words: 'assistant.tool.list_shots' },
  { name: 'get_schedule', kind: 'read', words: 'assistant.tool.get_schedule' },
  { name: 'get_call_sheet', kind: 'read', words: 'assistant.tool.get_call_sheet' },
  { name: 'list_people', kind: 'read', words: 'assistant.tool.list_people' },
  { name: 'list_gear', kind: 'read', words: 'assistant.tool.list_gear' },
  { name: 'list_locations', kind: 'read', words: 'assistant.tool.list_locations' },
  { name: 'get_plan', kind: 'read', words: 'assistant.tool.get_plan' },
  { name: 'list_suggestions', kind: 'read', words: 'assistant.tool.list_suggestions' },
  { name: 'run_checks', kind: 'check', words: 'assistant.tool.run_checks' },
  { name: 'suggest_shot_changes', kind: 'propose', words: 'assistant.tool.suggest_shot_changes' },
  { name: 'suggest_new_shots', kind: 'propose', words: 'assistant.tool.suggest_new_shots' },
  { name: 'suggest_reorder', kind: 'propose', words: 'assistant.tool.suggest_reorder' },
  { name: 'suggest_gear_for_day', kind: 'propose', words: 'assistant.tool.suggest_gear_for_day' },
  { name: 'suggest_call_sheet_notes', kind: 'propose', words: 'assistant.tool.suggest_call_sheet_notes' },
  { name: 'suggest_trash', kind: 'propose', words: 'assistant.tool.suggest_trash' },
] as const satisfies readonly AssistantTool[];

export type AssistantToolName = (typeof ASSISTANT_TOOLS)[number]['name'];

export const ASSISTANT_TOOL_KINDS: readonly AssistantToolKind[] = ['read', 'check', 'propose'];
