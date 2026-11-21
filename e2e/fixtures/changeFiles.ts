// Change files for the end-to-end tests (7.1): made up, for made-up projects and people only (Robin Vale, "Harbor
// Lights"). A file is for one project by its id, so the tests make it for the project they opened.

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
