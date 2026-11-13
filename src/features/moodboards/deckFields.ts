import { projectStore } from '../../app/projectStore';
import { getLocale, t } from '../../core/i18n';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { projectCompany } from '../../core/model/company';
import { castOf, characterName, isCastOnly, peopleByDepartment, projectCharacters, projectPeople } from '../../core/model/person';
import { projectDetails } from '../../core/model/projectDetails';
import type { SbdRecord } from '../../core/model/record';
import { ROLE_LABELS } from '../../core/model/role';
import { dayDateLabel, projectShootDays } from '../../core/model/shootDay';
import type { DeckField } from './pageFormats';

// What a field card shows (5.5): read from the project as it is now, never stored on the card. A deck goes to clients, so a
// people card is names and roles only, never a phone, an email or an address (CLAUDE.md: contact details are private).

type Records = Readonly<Record<string, SbdRecord>>;

/** A field card's words, '' when the project has nothing for it (the screen then shows the field's name, muted; a presentation nothing). */
export interface FieldValue {
  field: DeckField;
  text: string;
}

const clean = (value: string): string => value.trim();

/** One field's words, worked out once per version of the records and language. */
const cache = new WeakMap<Records, Map<string, FieldValue>>();
/** `fileName` is what the title falls back to when the project has none, as the sidebar does: the .sbd's name. */
export function fieldValue(records: Records, projectId: string | null, field: DeckField, locale: string = getLocale(), fileName: string = projectStore.getState().project?.name ?? ''): FieldValue {
  let byKey = cache.get(records);
  if (!byKey) {
    byKey = new Map();
    cache.set(records, byKey);
  }
  const key = `${locale}|${projectId ?? ''}|${field}|${fileName}`;
  let value = byKey.get(key);
  if (!value) {
    value = { field, text: readField(records, projectId, field, fileName) };
    byKey.set(key, value);
  }
  return value;
}

function readField(records: Records, projectId: string | null, field: DeckField, fileName: string): string {
  const project = projectId ? records[projectId] : undefined;
  if (!project || !projectId) return field === 'dates' ? t('deck.datesToCome') : '';
  switch (field) {
    case 'title':
      return typeof project.props.title === 'string' && clean(project.props.title) !== '' ? clean(project.props.title) : clean(fileName);
    case 'logline':
      return clean(projectDetails(project.props).logline);
    case 'format':
      return clean(projectDetails(project.props).format);
    case 'runtime':
      return clean(projectDetails(project.props).runtime);
    case 'company':
      return clean(projectCompany(project.props)?.name ?? '');
    case 'dates': {
      // The first and last shoot day, in the app's date format.
      const dated = projectShootDays(records, projectId).filter((day) => day.fields.date !== '');
      const first = dated[0];
      const last = dated.at(-1);
      if (!first || !last) return t('deck.datesToCome');
      return first === last || first.fields.date === last.fields.date
        ? dayDateLabel(first.fields.date)
        : t('deck.dates.range', { from: dayDateLabel(first.fields.date), to: dayDateLabel(last.fields.date) });
    }
    case 'cast':
      // Each character and who plays them; a character nobody plays yet is just the character.
      return projectCharacters(records, projectId)
        .map((character) => {
          const actor = castOf(records, character);
          const name = actor && typeof actor.props.name === 'string' ? clean(actor.props.name) : '';
          return name === '' ? characterName(character) : t('deck.castLine', { character: characterName(character), actor: name });
        })
        .join('\n');
    case 'crew': {
      // Key crew by department in the call sheet's order: name and role, nothing else about them.
      const crew = projectPeople(records, projectId).filter((person) => person.fields.name !== '' && !isCastOnly(person.fields) && person.fields.role !== 'client');
      return peopleByDepartment(crew)
        // Cast is its own field, and the client is not crew.
        .filter((group) => group.department !== 'cast' && group.department !== 'client')
        .map((group) => {
          const lines = group.people.map(({ fields }) => {
            const role = clean(fields.title) !== '' ? clean(fields.title) : fields.role !== null && fields.role !== 'other' ? ROLE_LABELS[fields.role] : '';
            return role === '' ? fields.name : t('deck.crewLine', { name: fields.name, role });
          });
          return group.department === null ? lines.join('\n') : [DEPARTMENT_LABELS[group.department].toUpperCase(), ...lines].join('\n');
        })
        .join('\n\n');
    }
  }
}
