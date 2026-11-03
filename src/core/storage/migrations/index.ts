import type { Migration } from '../migrate';
import { initial } from './001_initial';

/** Every migration, oldest first. A file's schema version is the number of migrations it has run. */
export const MIGRATIONS: readonly Migration[] = [initial];

export const SCHEMA_VERSION = MIGRATIONS.length;
