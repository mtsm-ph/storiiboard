import { useProject } from '../../app/projectStore';
import { list, t, tn } from '../../core/i18n';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { characterName, charactersPlayedBy, peopleByDepartment, projectPeople } from '../../core/model/person';
import { ROLE_LABELS } from '../../core/model/role';

// The Team section (3.5b): who is on the project, by department in the call sheet's order, each with their title (or
// role) and, for cast, the characters they play. Read from the same person records as Production's Cast and crew
// tile, which is where they're edited; no contacts here. From Phase 9 it also says what each person sees on the web.

export function TeamTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('people.noProject')}</p>;
  const people = projectPeople(records, project.projectId);
  if (people.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('team.none')}</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <p className="sb-label font-mono">{tn('people.count', people.length)}</p>
      {peopleByDepartment(people).map(({ department, people: inIt }) => {
        const heading = department ? DEPARTMENT_LABELS[department] : t('team.noDepartment');
        const headingId = `team-${department ?? 'none'}`;
        return (
          <section key={department ?? 'none'} aria-labelledby={headingId} className="flex flex-col gap-1">
            <h3 id={headingId} className="sb-label border-b-[1.5px] border-border pb-1">
              {heading}
            </h3>
            <ul className="flex flex-col">
              {inIt.map(({ record, fields }) => {
                const what = fields.title.trim() || (fields.role ? ROLE_LABELS[fields.role] : '');
                // The parts they play, under Cast, or where they're listed first when they aren't in Cast (a cameo).
                const listedFirst = department === 'cast' || (!fields.departments.includes('cast') && (fields.departments[0] ?? null) === department);
                const plays = listedFirst ? charactersPlayedBy(records, project.projectId, record.id).map(characterName) : [];
                return (
                  <li key={record.id} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[13px]">
                    <span className="font-semibold">{fields.name || t('people.unnamed')}</span>
                    {what && <span className="text-text-muted">{what}</span>}
                    {plays.length > 0 && <span className="text-text-muted">{t('team.as', { characters: list(plays) })}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
