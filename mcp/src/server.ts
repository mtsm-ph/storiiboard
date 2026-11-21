import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { checkedAnswer } from './guard';
import { readProject } from './project';
import { ProjectRefused } from './readOnlyFile';
import { getCallSheet, getPlan, getSchedule, listGear, listLocations, listPeople, listScenes, listShots, listSuggestions, projectSummary, ToolError, type ToolContext } from './tools';

// Storiiboard's MCP server, reading (7.5; docs/MCP.md). Started by the assistant's app (Claude Desktop, Claude Code)
// over stdio with the project files it may read: `node mcp/dist/server.js "/Users/robin/Shoots/Harbor Lights.sbd"`.
// It reads only those files, each read-only and fresh on every call, and never makes a request: there is no network
// code here. Whatever it returns goes to the assistant's maker, so every tool reads through the assistant view and
// every answer is checked for contact details before it leaves (guard.ts).

const SERVER = { name: 'storiiboard', version: '0.1.0' };

/** The project files this server was started with, each as an absolute path. */
export function startedWith(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.trim() !== '').map((arg) => resolve(arg));
}

const same = (a: string, b: string) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
const stem = (path: string) => (path.split(/[\\/]/).pop() ?? '').replace(/\.sbd$/i, '');

/** Which of the started projects a call means: by path or by name; the only one when it names none. */
function chosen(projects: readonly string[], asked: string | undefined): string {
  if (projects.length === 0) throw new ToolError('No project file was given to this server. Add the .sbd path to its arguments (docs/MCP.md).');
  if (asked === undefined || asked.trim() === '') {
    if (projects.length === 1) return projects[0] ?? '';
    throw new ToolError(`Name the project: ${projects.map(stem).join(', ')}.`);
  }
  const wanted = asked.trim();
  const found = projects.find((p) => same(p, resolve(wanted))) ?? projects.find((p) => same(stem(p), wanted.replace(/\.sbd$/i, '')));
  // Only a file the server was started with is ever opened: the assistant can't point it anywhere else.
  if (!found) throw new ToolError(`This server reads only ${projects.map(stem).join(', ')}.`);
  return found;
}

type Answer = { content: { type: 'text'; text: string }[]; isError?: boolean };

const refused = (text: string): Answer => ({ content: [{ type: 'text', text }], isError: true });

async function answer(projects: readonly string[], asked: string | undefined, run: (context: ToolContext) => unknown): Promise<Answer> {
  try {
    const data = await readProject(chosen(projects, asked));
    const checked = checkedAnswer(data.records, run({ data }));
    return checked.ok ? { content: [{ type: 'text', text: checked.text }] } : refused(checked.text);
  } catch (error) {
    if (error instanceof ToolError || error instanceof ProjectRefused) return refused(error.message);
    // Anything else is said plainly, never with its own message (it could name a path or a value).
    return refused("The project couldn't be read.");
  }
}

const project = z
  .string()
  .max(4096)
  .optional()
  .describe('The project: its file name without .sbd, or its path. Leave it out when the server reads one project.');
const includeTrashed = z.boolean().optional().describe('Also list items in the Trash, each marked trashed.');
const sceneNumber = z.string().min(1).max(20);
const dayName = z.string().min(1).max(20);
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** What each tool says it does, for the assistant (docs/MCP.md has each one's answer). */
const DESCRIPTIONS = {
  project_summary:
    'The project: its title, state, logline, what it holds (scenes, frames, setups, days, people, locations, gear) ' +
    'and its shoot days. Says what these tools never return.',
  list_scenes:
    'Every scene in board order: its number as on the slate, heading, INT/EXT, DAY/NIGHT, location, pages, ' +
    'characters, frames and setups.',
  list_shots:
    'The frames (shots) in board order with their slate numbers, size, lens, T-stop, support, height, move, status, ' +
    'action, dialogue, location, shoot day, setup, gear and department status. Narrow by scene number or shoot day.',
  get_schedule:
    "The shoot days in order: date, call and wrap, scenes, frames, setups and hours at the project's minutes per " +
    "setup, locations, how many are called and confirmed, the day's gear; and the frames still to schedule.",
  get_call_sheet:
    "One shoot day's call sheet as the app builds it: calls, scenes, cast with characters and HMU times, crew by " +
    "department, locations with sunrise, sunset, golden and blue hour, the emergency number and the nearest hospital's " +
    'name, notes and issued versions. No phone numbers, emails or addresses.',
  list_people:
    'Cast and crew: name, role, departments, call-sheet title and the characters each plays; and the characters with ' +
    'who plays them. No contact details.',
  list_gear:
    "The project's gear catalogue: name, kind (gear, camera body, lens), department, quantity, owned or rented and " +
    "from whom, day rate, watts; a body's sensor mode and size, a lens's focal range and squeeze.",
  list_locations:
    'The locations: name, status, power, notes, time zone, country, whether it has a place on the map, the nearest ' +
    'hospital by name, the scenes and frames set there. No address, contacts, parking or coordinates.',
  get_plan:
    "A setup's bird's-eye plan in real units, as the app draws it: walls, doors and windows in metres with their " +
    "heights, each camera's lens, sensor mode and field of view, each light's watts and the total, north, the sun's " +
    'position with sunrise and sunset and where each comes from, and each outside window\'s facing and hours of direct ' +
    "sun. Without a setup, the scene's room and blocking.",
  list_suggestions:
    'The suggestions waiting in the project (from change files and assistants), each with what it would change, its ' +
    'flags in words and whether it can still be applied. A person applies each one in the app.',
} as const;

/** Only the arguments given, so an optional one left out is never passed on as undefined. */
const given = <T extends Record<string, unknown>>(args: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

export function makeServer(projects: readonly string[]): McpServer {
  const server = new McpServer(SERVER);
  const tool = { annotations: readOnly };
  server.registerTool('project_summary', { ...tool, description: DESCRIPTIONS.project_summary, inputSchema: { project } }, async (args) =>
    answer(projects, args.project, (c) => projectSummary(c)),
  );
  server.registerTool(
    'list_scenes',
    { ...tool, description: DESCRIPTIONS.list_scenes, inputSchema: { project, include_trashed: includeTrashed } },
    async (args) => answer(projects, args.project, (c) => listScenes(c, given({ include_trashed: args.include_trashed }))),
  );
  server.registerTool(
    'list_shots',
    {
      ...tool,
      description: DESCRIPTIONS.list_shots,
      inputSchema: {
        project,
        scene: sceneNumber.optional().describe('A scene number as on the slate: "12", "4A".'),
        shoot_day: dayName.optional().describe('A shoot day: its date (YYYY-MM-DD) or its number ("3").'),
        include_trashed: includeTrashed,
      },
    },
    async (args) =>
      answer(projects, args.project, (c) => listShots(c, given({ scene: args.scene, shoot_day: args.shoot_day, include_trashed: args.include_trashed }))),
  );
  server.registerTool('get_schedule', { ...tool, description: DESCRIPTIONS.get_schedule, inputSchema: { project } }, async (args) =>
    answer(projects, args.project, (c) => getSchedule(c)),
  );
  server.registerTool(
    'get_call_sheet',
    { ...tool, description: DESCRIPTIONS.get_call_sheet, inputSchema: { project, day: dayName.describe('The day: its date (YYYY-MM-DD) or its number ("3").') } },
    async (args) => answer(projects, args.project, (c) => getCallSheet(c, { day: args.day })),
  );
  server.registerTool(
    'list_people',
    { ...tool, description: DESCRIPTIONS.list_people, inputSchema: { project, include_trashed: includeTrashed } },
    async (args) => answer(projects, args.project, (c) => listPeople(c, given({ include_trashed: args.include_trashed }))),
  );
  server.registerTool(
    'list_gear',
    { ...tool, description: DESCRIPTIONS.list_gear, inputSchema: { project, include_trashed: includeTrashed } },
    async (args) => answer(projects, args.project, (c) => listGear(c, given({ include_trashed: args.include_trashed }))),
  );
  server.registerTool(
    'list_locations',
    { ...tool, description: DESCRIPTIONS.list_locations, inputSchema: { project, include_trashed: includeTrashed } },
    async (args) => answer(projects, args.project, (c) => listLocations(c, given({ include_trashed: args.include_trashed }))),
  );
  server.registerTool(
    'get_plan',
    {
      ...tool,
      description: DESCRIPTIONS.get_plan,
      inputSchema: {
        project,
        scene: sceneNumber.describe('The scene number as on the slate: "12", "4A".'),
        setup: z.string().min(1).max(100).optional().describe('The setup: its number in the scene ("2") or its id.'),
      },
    },
    async (args) => answer(projects, args.project, (c) => getPlan(c, { scene: args.scene, ...given({ setup: args.setup }) })),
  );
  server.registerTool(
    'list_suggestions',
    {
      ...tool,
      description: DESCRIPTIONS.list_suggestions,
      inputSchema: {
        project,
        status: z.enum(['pending', 'approved', 'rejected', 'all']).optional().describe('Which to list; pending when left out.'),
        include_trashed: includeTrashed,
      },
    },
    async (args) => answer(projects, args.project, (c) => listSuggestions(c, given({ status: args.status, include_trashed: args.include_trashed }))),
  );
  return server;
}

/** Runs the server on stdio with the project files given on its command line. */
export async function main(argv: readonly string[]): Promise<void> {
  const server = makeServer(startedWith(argv));
  await server.connect(new StdioServerTransport());
}
