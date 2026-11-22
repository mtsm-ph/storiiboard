import { basename, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { withoutContacts } from '../../src/core/model/assistantView';
import { guardedAnswer } from './guard';
import { readProject } from './project';
import { ProjectRefused } from './readOnlyFile';
import { getCallSheet, getPlan, getSchedule, listGear, listLocations, listPeople, listScenes, listShots, listSuggestions, projectSummary, ToolError, type ToolContext } from './tools';

// Storiiboard's MCP server, reading (7.5; docs/MCP.md). Started by the assistant's app (Claude Desktop, Claude Code)
// over stdio with the project files it may read: `node mcp/dist/server.js "/Users/robin/Shoots/Harbor Lights.sbd"`.
// It reads only those files, each read-only and fresh on every call, and never makes a request: there is no network
// code here. Whatever it returns goes to the assistant's maker, so every tool reads through the assistant view and
// every answer is checked for contact details before it leaves (guard.ts).

const SERVER = { name: 'storiiboard', version: '0.1.0' };

const same = (a: string, b: string) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
const stem = (path: string) => basename(path).replace(/\.sbd$/i, '');

/** The project files this server was started with, each as an absolute path, once each (round 4). */
export function startedWith(argv: readonly string[]): string[] {
  const paths = argv.filter((arg) => arg.trim() !== '').map((arg) => resolve(arg));
  return paths.filter((path, index) => paths.findIndex((p) => same(p, path)) === index);
}

/**
 * Each project as the assistant is told of it: its name; when other projects share the name, the name numbered in the
 * order the server was given them ("Harbor Lights (1)", "Harbor Lights (2)"), skipping a number whose label is another
 * project's own name (round 4: a real "Harbor Lights (2).sbd"). Never its folder's name (round 3): a folder can name a
 * person or a client.
 */
function labelsOf(projects: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const taken = (wanted: string) => projects.some((p) => same(stem(p), wanted)) || [...labels.values()].some((l) => same(l, wanted));
  for (const path of projects) {
    if (labels.has(path)) continue;
    const sharing = projects.filter((p) => same(stem(p), stem(path)));
    if (sharing.length === 1) {
      labels.set(path, stem(path));
      continue;
    }
    let number = 0;
    for (const p of sharing) {
      number += 1;
      while (taken(`${stem(p)} (${String(number)})`)) number += 1;
      labels.set(p, `${stem(p)} (${String(number)})`);
    }
  }
  return labels;
}

function label(path: string, projects: readonly string[]): string {
  return labelsOf(projects).get(path) ?? stem(path);
}

const labels = (projects: readonly string[]) => projects.map((p) => label(p, projects)).join(', ');

/** Which of the started projects a call means: by its label, its path or its name; the only one when it names none. */
function chosen(projects: readonly string[], asked: string | undefined): string {
  if (projects.length === 0) throw new ToolError('No project file was given to this server. Add the .sbd path to its arguments (docs/MCP.md).');
  if (asked === undefined || asked.trim() === '') {
    if (projects.length === 1) return projects[0] ?? '';
    throw new ToolError(`Name the project: ${labels(projects)}.`);
  }
  const wanted = asked.trim();
  // The label the server gave a project that shares its name, as the assistant was told it.
  const byLabel = projects.find((p) => label(p, projects) !== stem(p) && same(label(p, projects), wanted));
  if (byLabel) return byLabel;
  const byPath = projects.find((p) => same(p, resolve(wanted)));
  if (byPath) return byPath;
  const byName = projects.filter((p) => same(stem(p), wanted.replace(/\.sbd$/i, '')));
  // Two files of one name in two folders: never a guess at which (round 2).
  if (byName.length > 1) {
    throw new ToolError(`${String(byName.length)} projects are named ${stem(byName[0] ?? '')}: name one as ${byName.map((p) => label(p, projects)).join(' or ')}.`);
  }
  // Only a file the server was started with is ever opened: the assistant can't point it anywhere else.
  if (!byName[0]) throw new ToolError(`This server reads only ${labels(projects)}.`);
  return byName[0];
}

type Answer = { content: { type: 'text'; text: string }[]; isError?: boolean };

// A refusal's words go through the free-text rule (round 3): they can repeat what the assistant asked for.
const refused = (text: string): Answer => ({ content: [{ type: 'text', text: withoutContacts(text) }], isError: true });

async function answer(projects: readonly string[], asked: string | undefined, run: (context: ToolContext) => unknown): Promise<Answer> {
  try {
    const data = await readProject(chosen(projects, asked));
    return { content: [{ type: 'text', text: JSON.stringify(guardedAnswer(data.records, run({ data }))) }] };
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

/** Each argument's rule in words: what a wrong one is told, in place of zod's own list (round 2). */
const ARGUMENT_WORDS: Readonly<Record<string, string>> = {
  project: "project is text: the project's file name without .sbd, or its path",
  include_trashed: 'include_trashed is true or false',
  scene: 'scene is a scene number as text, as on the slate ("12", "4A")',
  shoot_day: 'shoot_day is a date as text (YYYY-MM-DD) or a day number ("3")',
  day: 'day is a date as text (YYYY-MM-DD) or a day number ("3")',
  setup: 'setup is its number in the scene as text ("2"), or its id',
  status: 'status is pending, approved, rejected or all',
};

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

type ToolName = keyof typeof DESCRIPTIONS;

/** Only the arguments given, so an optional one left out is never passed on as undefined. */
const given = <T extends Record<string, unknown>>(args: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

interface Tool {
  shape: z.ZodRawShape;
  /** Runs on arguments its own shape has parsed (callTool). */
  run: (context: ToolContext, args: Record<string, unknown>) => unknown;
}

/** A tool's shape and what it does, its arguments typed by the shape. */
const tool = <S extends z.ZodRawShape>(shape: S, run: (context: ToolContext, args: z.infer<z.ZodObject<S>>) => unknown): Tool => ({
  shape,
  run: (context, args) => run(context, args as z.infer<z.ZodObject<S>>),
});

const TOOLS = {
  project_summary: tool({ project }, (c) => projectSummary(c)),
  list_scenes: tool({ project, include_trashed: includeTrashed }, (c, a) => listScenes(c, given({ include_trashed: a.include_trashed }))),
  list_shots: tool(
    {
      project,
      scene: sceneNumber.optional().describe('A scene number as on the slate: "12", "4A".'),
      shoot_day: dayName.optional().describe('A shoot day: its date (YYYY-MM-DD) or its number ("3").'),
      include_trashed: includeTrashed,
    },
    (c, a) => listShots(c, given({ scene: a.scene, shoot_day: a.shoot_day, include_trashed: a.include_trashed })),
  ),
  get_schedule: tool({ project }, (c) => getSchedule(c)),
  get_call_sheet: tool({ project, day: dayName.describe('The day: its date (YYYY-MM-DD) or its number ("3").') }, (c, a) => getCallSheet(c, { day: a.day })),
  list_people: tool({ project, include_trashed: includeTrashed }, (c, a) => listPeople(c, given({ include_trashed: a.include_trashed }))),
  list_gear: tool({ project, include_trashed: includeTrashed }, (c, a) => listGear(c, given({ include_trashed: a.include_trashed }))),
  list_locations: tool({ project, include_trashed: includeTrashed }, (c, a) => listLocations(c, given({ include_trashed: a.include_trashed }))),
  get_plan: tool(
    {
      project,
      scene: sceneNumber.describe('The scene number as on the slate: "12", "4A".'),
      setup: z.string().min(1).max(100).optional().describe('The setup: its number in the scene ("2") or its id.'),
    },
    (c, a) => getPlan(c, { scene: a.scene, ...given({ setup: a.setup }) }),
  ),
  list_suggestions: tool(
    {
      project,
      status: z.enum(['pending', 'approved', 'rejected', 'all']).optional().describe('Which to list; pending when left out.'),
      include_trashed: includeTrashed,
    },
    (c, a) => listSuggestions(c, given({ status: a.status, include_trashed: a.include_trashed })),
  ),
} satisfies Record<ToolName, Tool>;

/** A wrong call's words: which arguments are wrong and what each takes, never zod's list. */
function argumentWords(name: string, args: Record<string, unknown>, issues: readonly z.core.$ZodIssue[]): string {
  const keys = [...new Set(issues.map((issue) => (typeof issue.path[0] === 'string' ? issue.path[0] : '')))];
  const parts = keys.map((key) => {
    if (key === '') return 'the arguments are named values';
    const rule = ARGUMENT_WORDS[key] ?? `${key} isn't one of its arguments`;
    return args[key] === undefined ? `${key} is needed: ${rule}` : rule;
  });
  return `${name}: ${parts.join('; ')}.`;
}

/** Calls a tool as the assistant asked: its arguments checked by its own rules, a wrong one told in words. */
async function callTool(projects: readonly string[], name: string, raw: unknown): Promise<Answer> {
  if (!Object.hasOwn(TOOLS, name)) return refused(`There's no tool named ${name.slice(0, 64)}. The tools are ${Object.keys(TOOLS).join(', ')}.`);
  const entry: Tool = TOOLS[name as ToolName];
  const args = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const parsed = z.object(entry.shape).safeParse(raw ?? {});
  if (!parsed.success) return refused(argumentWords(name, args, parsed.error.issues));
  const values = parsed.data as { project?: string };
  return answer(projects, values.project, (context) => entry.run(context, parsed.data));
}

export function makeServer(projects: readonly string[]): McpServer {
  const server = new McpServer(SERVER);
  for (const [name, entry] of Object.entries(TOOLS) as [ToolName, Tool][]) {
    server.registerTool(name, { annotations: readOnly, description: DESCRIPTIONS[name], inputSchema: entry.shape }, async (args: Record<string, unknown>) =>
      callTool(projects, name, args),
    );
  }
  // The SDK lists the tools from the schemas above; calls come here instead, so a wrong argument is answered in our
  // words (round 2), not as zod's list of issues. Registered after the tools, so it replaces the SDK's own handler.
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(projects, request.params.name, request.params.arguments));
  return server;
}

/** Runs the server on stdio with the project files given on its command line. */
export async function main(argv: readonly string[]): Promise<void> {
  const server = makeServer(startedWith(argv));
  await server.connect(new StdioServerTransport());
}
