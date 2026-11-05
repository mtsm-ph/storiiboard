import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sceneFields, shotFields } from '../../core/model/storyboard';
import { departmentStatuses } from '../../core/model/departmentStatus';
import { DepartmentStatusTable } from './DepartmentStatusTable';
import { InspectorView } from './InspectorView';

const noop = () => undefined;
const scene = { id: 'sc4', fields: sceneFields({ number: '4', name: 'Penn Station', int_ext: 'INT', day_night: 'DAY', page_eighths: 11 }) };
const shot = {
  id: '4b',
  fields: shotFields({ number: '4B', size: 'MCU', lens_mm: 35, t_stop: 2, move: 'push in', status: 'need', departments: ['camera', 'sound'] }),
};

describe('the Frame inspector', () => {
  it('asks for a selection when there is none', () => {
    const html = renderToString(
      <InspectorView scene={null} shot={null} otherSceneNumbers={[]} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toContain('Select a frame or a scene');
  });

  it('shows the frame’s camera, status, story and departments, then its scene', () => {
    const html = renderToString(
      <InspectorView scene={scene} shot={shot} otherSceneNumbers={['5']} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toContain('>4B</p>');
    expect(html).toContain('SC 04 · INT. PENN STATION — DAY');
    expect(html).toMatch(/aria-checked="true"[^>]*>MCU</);
    expect(html).toContain('value="35"');
    expect(html).toMatch(/<option value="2" selected="">T2\.0<\/option>/);
    expect(html).toMatch(/aria-checked="true"[^>]*>Need</);
    // An older frame's departments read as Priority (polish 6): ticked, and listed first.
    expect(html).toMatch(/role="checkbox" aria-checked="true" aria-label="Camera: Priority"/);
    expect(html).toMatch(/role="checkbox" aria-checked="false" aria-label="Art: Priority"/);
    expect(html.indexOf('Sound: Priority')).toBeLessThan(html.indexOf('Direction: Priority'));
    // No role that approves: Approved says so, rather than hiding.
    expect(html).toMatch(/aria-disabled="true" title="Only the director or the DP approves\."/);
    expect(html).toContain('Set your role on this project in Settings → Project.');
    expect(html).toContain('value="1 3/8"');
  });

  it('keeps a value typed elsewhere visible, rather than dropping it', () => {
    const odd = { ...shot, fields: shotFields({ number: '4B', support: 'technocrane' }) };
    const html = renderToString(
      <InspectorView scene={scene} shot={odd} otherSceneNumbers={[]} onShotChange={noop} onSceneChange={noop} onSceneNumberChange={noop} onBack={noop} />,
    );
    expect(html).toMatch(/<option value="technocrane" selected="">Technocrane<\/option>/);
  });

  it('shows a director or DP their own sign-off on Approved: ticked when given, mixed when only someone else has', () => {
    const statuses = departmentStatuses({ department_status: { camera: { approvals: [{ name: 'Kevin Matos', roles: ['director'], at: 'x' }] } } });
    const approved = (roles: readonly ('director' | 'dp')[]) =>
      /aria-checked="([a-z]+)" aria-label="Camera: Approved"/.exec(
        renderToString(<DepartmentStatusTable statuses={statuses} approval={() => null} myRoles={roles} onEdit={noop} />),
      )?.[1];
    expect(approved(['director'])).toBe('true');
    expect(approved(['dp'])).toBe('mixed');
    expect(approved(['director', 'dp'])).toBe('true');
    // Someone who doesn't approve sees whether it's approved.
    expect(approved([])).toBe('true');
  });
});
