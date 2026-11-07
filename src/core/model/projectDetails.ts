import type { JsonValue, Props } from './record';
import { labels } from '../i18n';

// A project's production details (3.1, docs/PHASE3_DECISIONS.md 15): props on the project record, so each edit is an
// op and undoes. The stage is the job's progress, as in Kevin's Notion projects; it's never the project's state
// (draft, active, archived), which only says whether it's archived. The client contact is private, like every contact:
// it's shown where the person asks and never logged. Call sheets (Phase 4) and decks (Phase 5) read these.

export const PROJECT_STAGES = [
  'discovery',
  'contract',
  'preproduction',
  'production',
  'editing',
  'revising',
  'pending_invoice',
  'complete',
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABEL: Readonly<Record<ProjectStage, string>> = labels({
  discovery: 'projectStage.discovery',
  contract: 'projectStage.contract',
  preproduction: 'projectStage.preproduction',
  production: 'projectStage.production',
  editing: 'projectStage.editing',
  revising: 'projectStage.revising',
  pending_invoice: 'projectStage.pendingInvoice',
  complete: 'projectStage.complete',
});

export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === 'string' && (PROJECT_STAGES as readonly string[]).includes(value);
}

/** The person the project's work is for, as the producer reaches them. */
export interface ClientContact {
  name: string;
  company: string;
  email: string;
  phone: string;
}

/** One thing the job hands over: `60s TVC master`, `3 × 9:16 cutdowns`. */
export interface Deliverable {
  id: string;
  text: string;
  done: boolean;
}

export interface ProjectDetails {
  /** Null until it's set: a project needn't be a client job. */
  stage: ProjectStage | null;
  logline: string;
  /** As the producer says it: `TVC · 60s`, `Short film`, `Music video`. */
  format: string;
  /** As written: `60s`, `12 min`. Free text, as runtimes are said many ways. */
  runtime: string;
  client: ClientContact;
  deliverables: Deliverable[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const isRecord = (value: unknown): value is Record<string, JsonValue> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The project record's details, each one empty when it isn't set or isn't what it should be. */
export function projectDetails(props: Props | undefined): ProjectDetails {
  const client = isRecord(props?.client) ? props.client : {};
  const deliverables = Array.isArray(props?.deliverables) ? props.deliverables : [];
  return {
    stage: isProjectStage(props?.stage) ? props.stage : null,
    logline: text(props?.logline),
    format: text(props?.format),
    runtime: text(props?.runtime),
    client: { name: text(client.name), company: text(client.company), email: text(client.email), phone: text(client.phone) },
    deliverables: deliverables.flatMap((item): Deliverable[] =>
      isRecord(item) && typeof item.id === 'string' ? [{ id: item.id, text: text(item.text), done: item.done === true }] : [],
    ),
  };
}

/**
 * The client prop for a change to one of its fields. The others are kept as stored, any field this version doesn't
 * know included (CLAUDE.md: changing a record never drops its props).
 */
export function clientChange(props: Props | undefined, field: keyof ClientContact, value: string): Props {
  const stored = isRecord(props?.client) ? props.client : {};
  return { client: { ...stored, [field]: value } };
}

/**
 * The deliverables prop after `change`, which is given the list as stored: each item keeps any field this version
 * doesn't know.
 */
export function deliverablesChange(props: Props | undefined, change: (items: Record<string, JsonValue>[]) => Record<string, JsonValue>[]): Props {
  const stored = Array.isArray(props?.deliverables) ? props.deliverables.filter(isRecord) : [];
  return { deliverables: change(stored) };
}
