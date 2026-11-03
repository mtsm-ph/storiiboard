import type { Migration } from '../migrate';
import { initial } from './001_initial';
import { historyLog } from './002_history_log';
import { media } from './003_media';

/** Every migration, oldest first. A file's schema version is the number of migrations it has run. */
export const MIGRATIONS: readonly Migration[] = [initial, historyLog, media];

export const SCHEMA_VERSION = MIGRATIONS.length;
