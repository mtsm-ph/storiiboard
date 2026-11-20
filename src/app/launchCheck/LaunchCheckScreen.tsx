import { useEffect } from 'react';

/** The launch check's screen: an empty surface in the app's background, with no words to translate. */
export function LaunchCheckScreen({ onDrawn }: { onDrawn: () => void }) {
  // Reported from an effect, so React really committed the screen before the step says it did.
  useEffect(() => {
    onDrawn();
  }, [onDrawn]);
  return <div className="h-screen w-screen bg-bg" />;
}
