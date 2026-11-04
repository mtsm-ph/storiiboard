import { describe, expect, it } from 'vitest';
import { forGood } from './forGood';

/** A confirm the test answers when it chooses, as the desktop app's native dialog is answered. */
function pending() {
  let answer: (yes: boolean) => void = () => undefined;
  const asked = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  return { ask: () => asked, answer };
}

describe('a delete for good', () => {
  it('runs once the person says yes, with the same project open', async () => {
    let ran = 0;
    const result = await forGood({ current: false }, () => Promise.resolve(true), () => true, () => Promise.resolve(++ran));
    expect(result).toEqual({ ran: true, result: 1 });
  });

  it('deletes nothing when another project opened while the confirm was up', async () => {
    let open = 'Bey County';
    const confirm = pending();
    let ran = false;
    const shownFor = open;
    const going = forGood({ current: false }, confirm.ask, () => open === shownFor, () => Promise.resolve((ran = true)));
    open = 'Pilot';
    confirm.answer(true);
    expect(await going).toEqual({ ran: false, why: 'switched' });
    expect(ran).toBe(false);
  });

  it('starts no second run from a second click while the confirm is up, and allows one after', async () => {
    const running = { current: false };
    const confirm = pending();
    let runs = 0;
    const work = () => Promise.resolve(++runs);
    const first = forGood(running, confirm.ask, () => true, work);
    expect(await forGood(running, () => Promise.resolve(true), () => true, work)).toEqual({ ran: false, why: 'busy' });
    confirm.answer(true);
    await first;
    expect(runs).toBe(1);
    expect(await forGood(running, () => Promise.resolve(true), () => true, work)).toEqual({ ran: true, result: 2 });
  });

  it('runs nothing on Cancel, and lets go so the next click asks again', async () => {
    const running = { current: false };
    let ran = false;
    expect(await forGood(running, () => Promise.resolve(false), () => true, () => Promise.resolve((ran = true)))).toEqual({
      ran: false,
      why: 'cancelled',
    });
    expect(ran).toBe(false);
    expect(running.current).toBe(false);
  });

  it('lets go when the work fails, so a later try can run', async () => {
    const running = { current: false };
    await expect(forGood(running, () => Promise.resolve(true), () => true, () => Promise.reject(new Error('disk full')))).rejects.toThrow(
      'disk full',
    );
    expect(running.current).toBe(false);
  });
});
