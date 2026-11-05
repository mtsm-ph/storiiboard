import { describe, expect, it } from 'vitest';
import { ask } from './ask';

const question = (title: string) => ({
  title,
  text: 'Sure?',
  choices: [
    { id: 'cancel', label: 'Cancel' },
    { id: 'act', label: 'Do it', variant: 'warning' as const },
  ],
  cancel: 'cancel',
});

describe('a question in a window of the app’s own', () => {
  it('resolves to the cancel when a second question comes before an answer, so nothing waits forever', async () => {
    const first = ask(question('First'));
    // The second takes the window; the first is answered with its cancel.
    void ask(question('Second'));
    await expect(first).resolves.toBe('cancel');
  });
});
