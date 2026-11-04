import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Which new project's onboarding is showing (1.16): New project opens it once the project exists, and Create or Skip
// closes it. It belongs to that project alone: if another one opens meanwhile, it never shows for that one. Never
// saved; a project opened later goes straight to its board.

export const onboardingStore = createStore<{ projectId: string | null }>()(() => ({ projectId: null }));

export const openOnboarding = (projectId: string): void => {
  onboardingStore.setState({ projectId });
};

export const closeOnboarding = (): void => {
  onboardingStore.setState({ projectId: null });
};

export const useOnboardingProject = (): string | null => useStore(onboardingStore, (s) => s.projectId);
