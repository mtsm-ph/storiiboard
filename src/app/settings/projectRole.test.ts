import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, MAX_PROJECT_ROLES } from '../../core/storage/settings';
import { profileStore } from './profileStore';
import { approvalNow, projectSelfStore, setProjectSelf } from './projectRole';

// You in Cast and crew (3.5c): the pick kept on this computer, one per project, the newest kept; and the name an
// approval is signed with.

afterEach(() => {
  projectSelfStore.setState({}, true);
  profileStore.setState(EMPTY_PROFILE, true);
});

describe('who you are in each project’s Cast and crew', () => {
  it('keeps one person a project: picking another moves it, null stops it, other projects untouched', () => {
    setProjectSelf('p1', 'a');
    setProjectSelf('p2', 'x');
    setProjectSelf('p1', 'b');
    expect(projectSelfStore.getState()).toEqual({ p1: 'b', p2: 'x' });
    setProjectSelf('p1', null);
    expect(projectSelfStore.getState()).toEqual({ p2: 'x' });
  });

  it('keeps the newest picks once there are too many, the oldest falling off first', () => {
    for (let i = 0; i < MAX_PROJECT_ROLES + 20; i++) setProjectSelf(`p${String(i)}`, `person-${String(i)}`);
    const kept = projectSelfStore.getState();
    expect(Object.keys(kept)).toHaveLength(MAX_PROJECT_ROLES);
    expect(kept.p0).toBeUndefined();
    expect(kept[`p${String(MAX_PROJECT_ROLES + 19)}`]).toBe(`person-${String(MAX_PROJECT_ROLES + 19)}`);
  });
});

describe('an approval’s signature', () => {
  const at = new Date('2026-11-08T12:00:00.000Z');

  it('is the picked person’s name once you’ve picked yourself, else the profile’s', () => {
    profileStore.setState({ ...EMPTY_PROFILE, name: 'Sam Ortiz' }, true);
    expect(approvalNow('dp', at)?.name).toBe('Sam Ortiz');
    expect(approvalNow('director-dp', at, 'Kevin Matos')).toEqual({ name: 'Kevin Matos', roles: ['director', 'dp'], at: at.toISOString() });
    // A role that approves nothing gives no approval, whoever you are.
    expect(approvalNow('gaffer', at, 'Kevin Matos')).toBeNull();
  });

  it('stays initials when the profile asks for initials only', () => {
    profileStore.setState({ ...EMPTY_PROFILE, name: 'Sam Ortiz', historyInitials: true }, true);
    expect(approvalNow('dp', at, 'Kevin Matos')?.name).toBe('SO');
  });
});
