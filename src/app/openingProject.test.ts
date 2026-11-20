import { describe, expect, it } from 'vitest';
import { isOpeningProject, whileOpeningProject } from './openingProject';

describe('whileOpeningProject', () => {
  it('is opening while the open runs, and not once it is open', async () => {
    let during: boolean | null = null;
    const result = await whileOpeningProject(() => {
      during = isOpeningProject();
      return Promise.resolve('open');
    });
    expect(during).toBe(true);
    expect(result).toBe('open');
    expect(isOpeningProject()).toBe(false);
  });

  it('is not opening any more once the open fails, and the failure reaches the caller', async () => {
    await expect(whileOpeningProject(() => Promise.reject(new Error('not a project')))).rejects.toThrow('not a project');
    expect(isOpeningProject()).toBe(false);
  });

  it('stays opening until the last of two overlapping opens ends', async () => {
    let finishFirst!: () => void;
    const first = whileOpeningProject(() => new Promise<void>((resolve) => (finishFirst = resolve)));
    let finishSecond!: () => void;
    const second = whileOpeningProject(() => new Promise<void>((resolve) => (finishSecond = resolve)));
    finishFirst();
    await first;
    expect(isOpeningProject()).toBe(true);
    finishSecond();
    await second;
    expect(isOpeningProject()).toBe(false);
  });
});
