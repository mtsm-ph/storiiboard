import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackupsView, parseKeep } from './BackupsView';

const noop = () => undefined;
const keep = { recent: 12, days: 14 };

describe('the Backups tile', () => {
  it('takes only whole numbers in range for the keep settings', () => {
    expect(parseKeep('30', 'recent')).toBe(30);
    expect(parseKeep(' 7 ', 'days')).toBe(7);
    expect(parseKeep('0', 'days')).toBe(0);
    expect(parseKeep('0', 'recent')).toBeNull();
    expect(parseKeep('2.5', 'days')).toBeNull();
    expect(parseKeep('-1', 'days')).toBeNull();
    expect(parseKeep('999', 'days')).toBeNull();
    expect(parseKeep('twelve', 'recent')).toBeNull();
  });

  it('lists the open project’s backups in local time, each opening as a separate project', () => {
    const html = renderToString(
      <BackupsView
        keep={keep}
        onKeepChange={noop}
        project={{
          folder: '/Films/Backups',
          backups: [
            { name: 'Bey County 2026-11-02 14-05.sbd', at: new Date(2026, 10, 2, 14, 5) },
            { name: 'Bey County 2026-11-02 13-55.sbd', at: new Date(2026, 10, 2, 13, 55) },
          ],
        }}
        status={null}
        onBackUpNow={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('/Films/Backups');
    expect(html.indexOf('2026-11-02 14:05')).toBeLessThan(html.indexOf('2026-11-02 13:55'));
    expect(html).toContain('aria-label="Open the 2026-11-02 14:05 backup as a separate project"');
    expect(html).toContain('value="12"');
    expect(html).toContain('value="14"');
  });

  it('keeps the settings editable with no project open, since they apply to every project', () => {
    const html = renderToString(
      <BackupsView keep={keep} onKeepChange={noop} project={null} status={null} onBackUpNow={noop} onOpen={noop} />,
    );
    expect(html).toContain('No project open.');
    expect(html).not.toContain('Back up now');
    expect(html).toContain('Keep the last');
  });
});
