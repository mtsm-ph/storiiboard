import { companyProp, logoMark, projectCompany, type CompanyProfile } from '../../core/model/company';
import { imageStatements, mediaProps, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';
import type { Statement } from '../../core/storage/driver';

// The edits that attach a company profile to a project, update it from its profile, or take it off (3.2). One edit
// each, so one ⌘Z: the project's `company` prop and its logo picture together. A logo that's replaced or detached goes
// to the Trash, never deleted, so an undo brings it back; it's marked as the company's (`role`), so the Trash leaves it
// out of its list (restoring it alone would leave a picture nothing shows) and Empty Trash still clears it.

type Records = Readonly<Record<string, SbdRecord>>;

/** Marks a picture as a company's logo, kept with the copy, not one a person handles on its own. */
export const COMPANY_LOGO_ROLE = 'company_logo';

/**
 * The project's company logo as the copy names it: a live picture under this project, nothing else. A `logo_id` that
 * names a frame, a scene or the project itself (hand-edited, or from another tool) is never trashed or shown as one.
 */
export function companyLogo(records: Records, projectId: string, logoId: string | null): SbdRecord | null {
  const media = logoId ? records[logoId] : undefined;
  return media?.type === 'media' && media.parentId === projectId && media.trashedAt === null ? media : null;
}

/** Whether attaching `profile` needs its logo made into a picture: not when the project already has that very logo. */
export function needsLogo(records: Records, projectId: string, profile: CompanyProfile): boolean {
  if (!profile.logo) return false;
  const copy = projectCompany(records[projectId]?.props);
  return !(copy && copy.logoSource === logoMark(profile.logo) && companyLogo(records, projectId, copy.logoId));
}

/**
 * The edit that copies `profile` into the project. `logo` is the profile's logo made into a picture, when needsLogo
 * said so; otherwise the project's own copy of the same logo is kept as it is.
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
  const copy = projectCompany(project.props);
  const old = companyLogo(records, projectId, copy?.logoId ?? null);
  let logoId: string | null = null;
  if (profile.logo && old && copy?.logoSource === logoMark(profile.logo)) {
    // The same logo: kept, not made again.
    logoId = old.id;
  } else if (profile.logo && logo) {
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
        props: { ...mediaProps(logo, { name: 'logo.png' }, projectPath), role: COMPANY_LOGO_ROLE },
      },
    });
    alsoWrite.push(...imageStatements(logo, now));
  }
  if (old && old.id !== logoId) changes.push({ kind: 'trash', id: old.id });
  const set = { company: companyProp(project.props.company, profile, logoId) };
  if (JSON.stringify(project.props.company) !== JSON.stringify(set.company) || changes.length > 0) changes.push({ kind: 'update', id: projectId, set });
  return { changes, alsoWrite };
}

/** The edit that takes the company off the project, its logo to the Trash. */
export function detachCompany(records: Records, projectId: string): Change[] {
  const project = records[projectId];
  const copy = project ? projectCompany(project.props) : null;
  if (!project || !copy) return [];
  const logo = companyLogo(records, projectId, copy.logoId);
  return [...(logo ? [{ kind: 'trash' as const, id: logo.id }] : []), { kind: 'update', id: projectId, unset: ['company'] }];
}
