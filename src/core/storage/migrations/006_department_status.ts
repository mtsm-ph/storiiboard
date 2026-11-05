import type { Migration } from '../migrate';

// Schema v6 (polish 6, approved by Kevin Nov 5): department status per shot. A shot kept `departments`, the list of
// departments it needed (on/off tags); it now keeps `department_status`, how far each department has got with it
// (src/core/model/departmentStatus.ts). Each department that was on becomes Priority, the departments a shot depends
// on most; the list comes off. Text ids only, each once; anything else in the list was never a department.
//
// migrate() copies the file to a backup before this runs, as before every migration. The edit log is append-only and
// keeps the old lists: a point restored from before this reads them as Priority (departmentStatuses).

export const departmentStatus: Migration = {
  version: 6,
  description: 'Department status per shot: department_status in place of departments',
  statements: [
    {
      sql: `UPDATE records
        SET props = json_remove(
          json_set(props, '$.department_status', json((
            SELECT json_group_object(id, json('{"priority":true}'))
              FROM (SELECT DISTINCT value AS id FROM json_each(records.props, '$.departments') WHERE type = 'text')
          ))),
          '$.departments')
        WHERE type = 'shot' AND json_type(props, '$.departments') = 'array'`,
    },
  ],
};
