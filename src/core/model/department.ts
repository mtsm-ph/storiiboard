import { labels } from '../i18n';
/** Departments as a production names them on the call sheet. */
export const DEPARTMENTS = [
  'direction',
  'camera',
  'grip-electric',
  'art',
  'hmu',
  'wardrobe',
  'sound',
  'production',
  'post',
  'cast',
  'client',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Readonly<Record<Department, string>> = labels({
  direction: 'department.direction',
  camera: 'department.camera',
  'grip-electric': 'department.grip-electric',
  art: 'department.art',
  hmu: 'department.hmu',
  wardrobe: 'department.wardrobe',
  sound: 'department.sound',
  production: 'department.production',
  post: 'department.post',
  cast: 'department.cast',
  client: 'department.client',
});

export const isDepartment = (value: unknown): value is Department => typeof value === 'string' && (DEPARTMENTS as readonly string[]).includes(value);
