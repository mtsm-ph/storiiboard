// A module worker the end-to-end tests start from the test page by its address (e2e/workerCsp.spec.ts): it tries what a
// worker's content security policy should refuse (src-tauri/worker-csp.txt) and posts back which of them ran. A
// worker takes its policy from its own script's response, never from the page that starts it, so this is the one way
// to see the policy the app's workers (the PDF reader, the theme's accent reader) run under. Its refusals are the
// meant ones, known by this file's address (scripts/e2eCsp.ts, CSP_EXPECTED_WORKER).

async function ran(attempt: () => unknown): Promise<boolean> {
  try {
    await attempt();
    return true;
  } catch {
    return false;
  }
}

void (async () => {
  // The probe's whole point: are eval and new Function refused here?
  const evalRan = await ran(() => (0, eval)('1'));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const functionRan = await ran(() => new Function(''));
  // The app's own origin: a worker that reads strangers' files may reach nothing, not even home.
  const fetchRan = await ran(() => fetch('/?worker-probe'));
  self.postMessage({ eval: evalRan, function: functionRan, fetch: fetchRan });
})();
