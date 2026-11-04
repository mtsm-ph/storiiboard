import type { Migration } from '../migrate';
import { initial } from './001_initial';
import { historyLog } from './002_history_log';
import { media } from './003_media';
import { versions } from './004_versions';
import { slateNumbers } from './005_slate_numbers';

/** Every migration, oldest first. A file's schema version is the number of migrations it has run. */
export const MIGRATIONS: readonly Migration[] = [initial, historyLog, media, versions, slateNumbers];

export const SCHEMA_VERSION = MIGRATIONS.length;
