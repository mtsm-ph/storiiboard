// Change files for the end-to-end tests (7.1): made up, for made-up projects and people only (Robin Vale, "Harbor
// Lights" open, "Saltmarsh" another). A file is for one project by its id, so the tests make it for the project they
// opened.

export const OTHER_PROJECT_ID = '6f1c0d2e-8a4b-4c3d-9e2f-1a0b9c8d7e6f';

/** A change file from the assistant with two suggestions by Robin Vale, for the project `projectId`. */
export function changeFileFor(projectId: string, projectName: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: 'storiiboard.changes',
      version: 1,
      id: '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11',
      project_id: projectId,
      project_name: projectName,
      created_by: 'mcp',
      created_at: '2026-11-21T09:12:00.000Z',
      people: [{ id: 'r1', name: 'Robin Vale', role: 'dp' }],
      suggestions: [
        {
          id: 'f2b7a1c0-1111-4c47-9a7e-2b1f0c6e9a11',
          kind: 'create',
          target: { type: 'scene', label: 'A new scene at the pier' },
          author: 'r1',
          created_at: '2026-11-21T09:10:31.000Z',
          note: '<b>Not bold</b>, just text.',
          data: { type: 'scene', parent_id: projectId, after_id: null, props: { name: 'Pier' } },
        },
        {
          id: 'f2b7a1c0-2222-4c47-9a7e-2b1f0c6e9a11',
          kind: 'trash',
          target: { id: 'f2b7a1c0-9999-4c47-9a7e-2b1f0c6e9a11', type: 'shot', label: 'SC 04 · 4B', updated_at: '2026-11-20T17:41:09.000Z' },
          author: 'r1',
          created_at: '2026-11-21T09:11:02.000Z',
          note: 'We have this in 4A.',
          data: {},
        },
      ],
    }),
  );
}

/** The records a review file (7.2) names: the open project's first scene and its two frames, as the page has them. */
export interface ReviewTargets {
  projectId: string;
  sceneId: string;
  frameA: string;
  frameB: string;
  /** When 1B was last written: the trash's target saw it so. */
  frameBUpdatedAt: string;
}

export const REVIEW_FILE_ID = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a77';

/**
 * A change file from Robin Vale for the review screen (7.2), in the file's order: 1B to the Trash, 1A's lens to 85 mm
 * (Robin saw 50 mm, so it changed since), a new scene "Pier" after SC 01 with two frames in it, and 1B moved to the
 * start of SC 01.
 */
export function reviewFileFor(targets: ReviewTargets): Buffer {
  const { projectId, sceneId, frameA, frameB, frameBUpdatedAt } = targets;
  const scene = 'f2b7a1c0-0003-4c47-9a7e-2b1f0c6e9a11';
  const wide = 'f2b7a1c0-0004-4c47-9a7e-2b1f0c6e9a11';
  const suggestion = (n: number, rest: Record<string, unknown>) => ({
    id: `f2b7a1c0-000${String(n)}-4c47-9a7e-2b1f0c6e9a11`,
    author: 'r1',
    created_at: '2026-11-21T09:10:31.000Z',
    ...rest,
  });
  return Buffer.from(
    JSON.stringify({
      format: 'storiiboard.changes',
      version: 1,
      id: REVIEW_FILE_ID,
      project_id: projectId,
      project_name: 'Harbor Lights',
      created_by: 'mcp',
      created_at: '2026-11-21T09:12:00.000Z',
      people: [{ id: 'r1', name: 'Robin Vale', role: 'dp' }],
      suggestions: [
        suggestion(1, { kind: 'trash', target: { id: frameB, type: 'shot', label: 'SC 01 · 1B', updated_at: frameBUpdatedAt }, note: 'We have this in 1A.', data: {} }),
        suggestion(2, { kind: 'update', target: { id: frameA, type: 'shot', label: 'SC 01 · 1A', updated_at: frameBUpdatedAt }, data: { props: { lens_mm: 85 }, before: { lens_mm: 50 } } }),
        suggestion(3, { kind: 'create', target: { type: 'scene', label: 'Pier' }, data: { type: 'scene', parent_id: projectId, after_id: sceneId, props: { name: 'Pier' } } }),
        suggestion(4, { kind: 'create', target: { type: 'shot', label: 'Wide on the pier' }, data: { type: 'shot', parent_id: scene, after_id: null, props: { size: 'WS' } } }),
        suggestion(5, { kind: 'create', target: { type: 'shot', label: 'Close on the rope' }, data: { type: 'shot', parent_id: scene, after_id: wide, props: { size: 'CU' } } }),
        suggestion(6, { kind: 'reorder', target: { id: frameB, type: 'shot', label: 'SC 01 · 1B', updated_at: frameBUpdatedAt }, data: { parent_id: sceneId, after_id: null } }),
      ],
    }),
  );
}
