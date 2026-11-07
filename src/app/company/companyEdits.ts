import { companyProp, projectCompany, type CompanyProfile } from '../../core/model/company';
import { imageStatements, mediaProps, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';
import type { Statement } from '../../core/storage/driver';

// The edits that attach a company profile to a project, update it from its profile, or take it off (3.2). One edit
// each, so one ⌘Z: the project's `company` prop and its logo picture together. The old logo goes to the Trash, never
// deleted, so an undo brings it back.

type Records = Readonly<Record<string, SbdRecord>>;

/**
 * The edit that copies `profile` into the project, with `logo` (the profile's logo made into a picture) as its own
 * picture under the project. Attaching again, or updating, replaces the copy and the logo.
 */
export function attachCompany(
  records: Records,
  projectId: string,
  profile: CompanyProfile,
  logo: PreparedImage | null,
  projectPath: string,
  now = new Date(),
): { changes: Change[]; alsoWrite: Statement[] } {
  const project = records[projectId];
  if (!project) return { changes: [], alsoWrite: [] };
  const changes: Change[] = [];
  const alsoWrite: Statement[] = [];
  const old = projectCompany(project.props)?.logoId ?? null;
  let logoId: string | null = null;
  if (logo) {
    const siblings = Object.values(records).filter((r) => r.parentId === projectId && r.type === 'media');
    const last = siblings.reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
    logoId = crypto.randomUUID();
    changes.push({
      kind: 'create',
      record: {
        id: logoId,
        type: 'media',
        parentId: projectId,
        sortKey: keyBetween(last, null),
        props: mediaProps(logo, { name: `${profile.name || 'Company'} logo.png` }, projectPath),
      },
    });
    alsoWrite.push(...imageStatements(logo, now));
  }
  if (old && records[old]?.trashedAt === null) changes.push({ kind: 'trash', id: old });
  changes.push({ kind: 'update', id: projectId, set: { company: companyProp(project.props.company, profile, logoId) } });
  return { changes, alsoWrite };
}

/** The edit that takes the company off the project, its logo to the Trash. */
export function detachCompany(records: Records, projectId: string): Change[] {
  const project = records[projectId];
  const company = project ? projectCompany(project.props) : null;
  if (!project || !company) return [];
  const logo = company.logoId;
  return [
    ...(logo && records[logo]?.trashedAt === null ? [{ kind: 'trash' as const, id: logo }] : []),
    { kind: 'update', id: projectId, unset: ['company'] },
  ];
}
