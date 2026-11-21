import { invoke } from '@tauri-apps/api/core';
import { createRoot } from 'react-dom/client';
import { readPdfText } from '../../features/script/readPdf';
import { askWorkerAlone } from '../../ui/theme/generator/extract';
import { accentCandidates } from '../../ui/theme/generator/generate';
import { samplePixels } from '../../ui/theme/generator/sample';
import { LAUNCH_CHECK_LINE, LAUNCH_CHECK_PDF, LAUNCH_CHECK_PNG } from './builtIn';
import { fromBase64, runLaunchCheck, type CheckWindow, type LaunchCheckWatch, type PageStep } from './launchCheck';
import { LaunchCheckScreen } from './LaunchCheckScreen';

// The launch check on the real page (6.27l): main.tsx calls this instead of drawing the app when Rust's watch script
// is there. It reads and writes no storage, opens no project and calls no command but launch_check_step.

declare global {
  interface Window {
    /** Defined by Rust's watch script (src-tauri/src/launch_check.rs), in the launch check only. */
    __STORIIBOARD_LAUNCH_CHECK__?: LaunchCheckWatch;
  }
}

/** Reports one step to Rust. */
function report(step: PageStep, ok: boolean, detail: string): Promise<void> {
  return invoke('launch_check_step', { step, ok, detail });
}

export function startLaunchCheck(root: HTMLElement, watch: LaunchCheckWatch): void {
  const page = window as unknown as CheckWindow;
  void runLaunchCheck({
    report,
    drawScreen: () =>
      new Promise<void>((resolve) => {
        createRoot(root).render(<LaunchCheckScreen onDrawn={resolve} />);
      }),
    readPdfText,
    accentsFromWorker: askWorkerAlone,
    // The worker's four stages on the page itself, after a failure only (6.27q): no worker, no fallback in between.
    accentsOnPage: async (picture) => {
      const { data, width, height } = await samplePixels(picture);
      return { width, height, accents: accentCandidates(data, width, height).length };
    },
    // The page's own files only: the worker scripts the app's own code just started.
    getFile: (url) => fetch(url),
    document,
    window: page,
    baseUrl: window.location.href,
    violations: watch.violations,
    pdf: fromBase64(LAUNCH_CHECK_PDF).buffer,
    pdfLine: LAUNCH_CHECK_LINE,
    picture: new Blob([fromBase64(LAUNCH_CHECK_PNG)], { type: 'image/png' }),
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }).catch((error: unknown) => {
    // A report Rust refused: Rust's time limit names the step it was waiting for.
    console.error('launch check:', error);
  });
}
