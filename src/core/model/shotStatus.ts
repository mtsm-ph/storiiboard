import { labels } from '../i18n';
/**
 * Where a frame's picture stands, from Kevin's Notion habit: already have it, need to shoot it, or need to
 * source it. The schedule only pulls "need" frames into shoot days.
 */
export const SHOT_STATUSES = ['have', 'need', 'source'] as const;

export type ShotStatus = (typeof SHOT_STATUSES)[number];

export const SHOT_STATUS_LABELS: Readonly<Record<ShotStatus, string>> = labels({
  have: 'shotStatus.have',
  need: 'shotStatus.need',
  source: 'shotStatus.source',
});
