import { invoke } from '@tauri-apps/api/core';
import { t, type MessageKey } from '../core/i18n';
import { isTauriApp } from './fileAccess';

// The service switch as Settings → Online services shows it (4.0). The switch itself is read by Rust
// (src-tauri/src/services.rs), at most once a day and only just before a service is used; this asks what it last
// said, and never makes it read. Words people see never come from the switch file: it sends a reason code, and the
// words are here, in the translation files.

export type ServiceState = 'on' | 'off' | 'unchecked';

export interface ServiceStatus {
  id: string;
  /** The server in use now, as an address. */
  server: string;
  state: ServiceState;
  /** The switch's reason code when off. */
  reason: string | null;
}

/** What a browser build shows: the services this app may contact, not yet checked (the switch is read by the desktop app). */
export const BROWSER_SERVICES: readonly ServiceStatus[] = [
  { id: 'nominatim', server: 'https://nominatim.openstreetmap.org', state: 'unchecked', reason: null },
];

function isStatus(value: unknown): value is ServiceStatus {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.server === 'string' && (v.state === 'on' || v.state === 'off' || v.state === 'unchecked');
}

export async function servicesStatus(): Promise<readonly ServiceStatus[]> {
  if (!isTauriApp) return BROWSER_SERVICES;
  const answer = await invoke<unknown>('services_status');
  return Array.isArray(answer) && answer.every(isStatus) ? answer : BROWSER_SERVICES;
}

/** The words for a reason code; a code the app doesn't know reads "Turned off for now". */
export function offReason(code: string | null): string {
  return t(code === 'operator-request' ? 'services.off.operatorRequest' : code === 'maintenance' ? 'services.off.maintenance' : 'services.off.unknown');
}

/** Rust's error for a service that is off starts with this; the reason code follows (services.rs `OFF_PREFIX`). */
const OFF_PREFIX = 'service-off:';

/** The off reason in an error from Rust, else null. */
export function offReasonFrom(message: string): string | null {
  return message.startsWith(OFF_PREFIX) ? message.slice(OFF_PREFIX.length) : null;
}

/** Descriptions of the services the app may contact, by id (what for, and when). */
export const SERVICE_WORDS: Readonly<Record<string, { name: MessageKey; purpose: MessageKey; when: MessageKey }>> = {
  nominatim: { name: 'services.nominatim.name', purpose: 'services.nominatim.purpose', when: 'services.nominatim.when' },
};
