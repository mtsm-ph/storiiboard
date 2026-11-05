import { describe, expect, it, vi } from 'vitest';
import { ask, currentQuestion } from './ask';

// The lock question reads the date and its words; nothing it does reaches the system's dialogs any more.
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn() }));

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
  it('answers a first question with its cancel when a second comes, and leaves the second showing', async () => {
    const first = ask(question('First'));
    const second = ask(question('Second'));
    await expect(first).resolves.toBe('cancel');
    expect(currentQuestion()?.title).toBe('Second');
    currentQuestion()?.answer('act');
    await expect(second).resolves.toBe('act');
    expect(currentQuestion()).toBeNull();
  });

  it('asks how to open a project another computer has open: Cancel first, then Open Anyway as a risk, then Open a Copy', async () => {
    const { askWhenLocked } = await import('./projects/dialogs');
    for (const [id, choice] of [['copy', 'copy'], ['anyway', 'anyway'], ['cancel', 'cancel']] as const) {
      const asked = askWhenLocked({ computer: 'Studio iMac', openedAt: Date.UTC(2026, 10, 5, 9, 30) }, '/Jobs/Bey County.sbd');
      const showing = currentQuestion();
      expect(showing?.title).toBe('Open on another computer');
      expect(showing?.text).toContain('“Bey County” has been open on Studio iMac since');
      expect(showing?.choices.map((c) => [c.id, c.variant ?? null])).toEqual([
        ['cancel', null],
        ['anyway', 'warning'],
        ['copy', 'primary'],
      ]);
      showing?.answer(id);
      await expect(asked).resolves.toBe(choice);
    }
  });
});
