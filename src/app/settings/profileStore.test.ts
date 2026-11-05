import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_PROFILE } from '../../core/storage/settings';
import { editAuthor, profileStore } from './profileStore';
import { approvalNow } from './projectRole';

// Who an edit or an approval is signed by (Kevin, Nov 5): the profile's name, or its initials when chosen.

afterEach(() => {
  profileStore.setState(EMPTY_PROFILE);
});

describe('signing edits', () => {
  it('signs with the name, or the initials if chosen, and with no name at all as before', () => {
    const kevin = { ...EMPTY_PROFILE, name: 'Kevin Matos' };
    expect(editAuthor(kevin)).toBe('Kevin Matos');
    expect(editAuthor({ ...kevin, historyInitials: true })).toBe('KM');
    expect(editAuthor({ ...kevin, initials: 'KJM', historyInitials: true })).toBe('KJM');
    // Only initials typed, no name: the initials, whatever the switch says.
    expect(editAuthor({ ...EMPTY_PROFILE, initials: 'KM' })).toBe('KM');
    // Nothing filled in: the log's own word for no name, as every edit before names were kept.
    expect(editAuthor(EMPTY_PROFILE)).toBe('local');
    expect(editAuthor({ ...EMPTY_PROFILE, historyInitials: true })).toBe('local');
  });

  it('signs an approval by the same rule, so initials only never lets the name into the file', () => {
    profileStore.setState({ ...EMPTY_PROFILE, name: 'Kevin Matos', role: 'dp' });
    expect(approvalNow('dp')?.name).toBe('Kevin Matos');
    profileStore.setState({ ...EMPTY_PROFILE, name: 'Kevin Matos', role: 'dp', historyInitials: true });
    expect(approvalNow('dp')?.name).toBe('KM');
    profileStore.setState({ ...EMPTY_PROFILE, role: 'dp' });
    expect(approvalNow('dp')?.name).toBe('');
  });
});
