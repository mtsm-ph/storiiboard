import type { Migration } from '../migrate';
import { initial } from './001_initial';
import { historyLog } from './002_history_log';
import { media } from './003_media';
import { versions } from './004_versions';
import { slateNumbers } from './005_slate_numbers';
import { departmentStatus } from './006_department_status';
import { shotSeen } from './007_shot_seen';
import { video } from './008_video';
import { sceneApprovals } from './009_scene_approvals';
import { notifications } from './010_notifications';
import { lookups } from './011_lookups';
import { characterIds } from './012_character_ids';

/** Every migration, oldest first. A file's schema version is the number of migrations it has run. */
export const MIGRATIONS: readonly Migration[] = [initial, historyLog, media, versions, slateNumbers, departmentStatus, shotSeen, video, sceneApprovals, notifications, lookups, characterIds];

export const SCHEMA_VERSION = MIGRATIONS.length;
