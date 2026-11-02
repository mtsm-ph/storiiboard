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

export const DEPARTMENT_LABELS: Record<Department, string> = {
  direction: 'Direction',
  camera: 'Camera',
  'grip-electric': 'Grip & electric',
  art: 'Art',
  hmu: 'HMU',
  wardrobe: 'Wardrobe',
  sound: 'Sound',
  production: 'Production',
  post: 'Post',
  cast: 'Cast',
  client: 'Client',
};
