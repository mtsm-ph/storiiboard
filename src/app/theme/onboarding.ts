import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Which new project's onboarding is showing (1.16): New project opens it once the project exists, and Create or Skip
// closes it. It belongs to that project's file alone: if another one opens meanwhile (a Finder duplicate has the same
// project id, so the path counts too), it closes. Never saved; a project opened later goes straight to its board.

export interface OnboardingFor {
  projectId: string;
  path: string;
}

export const onboardingStore = createStore<{ project: OnboardingFor | null }>()(() => ({ project: null }));

export const openOnboarding = (project: OnboardingFor): void => {
  onboardingStore.setState({ project });
};

export const closeOnboarding = (): void => {
  onboardingStore.setState({ project: null });
};

export const useOnboardingProject = (): OnboardingFor | null => useStore(onboardingStore, (s) => s.project);
