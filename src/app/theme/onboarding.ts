import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Whether the new project's onboarding is showing (1.16): New project opens it once the project exists, and Create or
// Skip closes it. It's never saved; a project opened later goes straight to its board.

export const onboardingStore = createStore<{ open: boolean }>()(() => ({ open: false }));

export const openOnboarding = (): void => {
  onboardingStore.setState({ open: true });
};

export const closeOnboarding = (): void => {
  onboardingStore.setState({ open: false });
};

export const useOnboardingOpen = (): boolean => useStore(onboardingStore, (s) => s.open);
