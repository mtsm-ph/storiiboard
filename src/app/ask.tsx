import { useId } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { t } from '../core/i18n';
import { Button } from '../ui/Button';
import { InAppWindow } from '../ui/InAppWindow';

// A question the app asks in a window of its own (polish B), never the system's message box: a confirm for what can't
// be undone, the choice of how to open a project another computer has open. One at a time; asking while one is up
// answers the first with its cancel, so nothing waits forever behind another.

export interface Choice {
  id: string;
  label: string;
  variant?: 'primary' | 'warning';
}

interface Asked {
  title: string;
  text: string;
  /** In the order they're drawn; the cancel is drawn first, the way the kit's dialogs read. */
  choices: readonly Choice[];
  /** What Escape, the close button or a second question answers. */
  cancel: string;
  answer: (id: string) => void;
}

const askStore = createStore<{ asked: Asked | null }>()(() => ({ asked: null }));

/** The question showing now, for tests that answer it as a person would. */
export function currentQuestion(): Readonly<Omit<Asked, 'answer'>> & { answer: (id: string) => void } | null {
  return askStore.getState().asked;
}

/** Asks, and resolves to the id of the choice picked, or `cancel` when the window was closed without one. */
export function ask(question: Omit<Asked, 'answer'>): Promise<string> {
  askStore.getState().asked?.answer(askStore.getState().asked?.cancel ?? '');
  return new Promise((resolve) => {
    const asked: Asked = {
      ...question,
      answer: (id) => {
        if (askStore.getState().asked === asked) askStore.setState({ asked: null });
        resolve(id);
      },
    };
    askStore.setState({ asked });
  });
}

/**
 * A confirm for what can't be undone (1.21: Empty Trash, Clean up old pictures; 1.23: Delete version). Resolves to
 * true only when the person picks the action itself.
 */
export async function confirmForGood(title: string, text: string, action: string): Promise<boolean> {
  const answer = await ask({
    title,
    text,
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'act', label: action, variant: 'warning' },
    ],
    cancel: 'cancel',
  });
  return answer === 'act';
}

/** Where the question shows: once, at the shell's root. */
export function AskHost() {
  const asked = useStore(askStore, (s) => s.asked);
  const textId = useId();
  if (!asked) return null;
  // The window opens with focus on its first button, Cancel: Enter never deletes by accident.
  return (
    <InAppWindow
      key={asked.title + asked.text}
      title={asked.title}
      onClose={() => {
        asked.answer(asked.cancel);
      }}
      width={460}
      // Read as it opens: the question and why, not just its title and the button focus lands on.
      describedBy={textId}
      // Plain "Close", which answers the cancel: "Close Empty Trash?" heard aloud sounds like the action itself.
      closeLabel={t('window.closePlain')}
    >
      <div className="flex flex-col gap-4 p-4">
        <p id={textId} className="text-[13px] whitespace-pre-line">
          {asked.text}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {asked.choices.map((choice) => (
            <Button
              key={choice.id}
              {...(choice.variant ? { variant: choice.variant } : {})}
              onClick={() => {
                asked.answer(choice.id);
              }}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </div>
    </InAppWindow>
  );
}
