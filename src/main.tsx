import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './app/App';
import { setLocale } from './core/i18n';
import { loadSettings } from './core/storage/settings';
import { installTabWrap } from './ui/tabWrap';
import { installClickFocus } from './ui/clickFocus';
import { fileMode } from './app/fileAccess';
import { startLaunchCheck } from './app/launchCheck/start';
import { installHeicDecoder } from './app/heicPicture';

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

// The launch check (6.27l): Rust defines this only when the app was started with STORIIBOARD_LAUNCH_CHECK=1, and then
// the page runs the check and nothing else. The imports above stay static, so the whole bundle still loads and runs.
const launchCheck = window.__STORIIBOARD_LAUNCH_CHECK__;
if (launchCheck) {
  startLaunchCheck(root, launchCheck);
} else {
  // The person's language before the first render, so nothing draws in English first.
  setLocale(loadSettings().language);

  // Tab goes round the page or the top window, never out of it: the desktop webview has nowhere else to go. Not in a
  // plain browser build (the web companion to come), where Tab should still reach the browser's own toolbar.
  if (fileMode !== 'none') installTabWrap();
  // A clicked button takes focus in every engine, as Chromium gives it: WebKit (the Mac app) gives it none.
  if (fileMode !== 'none') installClickFocus();
  // A HEIC the webview can't read goes to Rust (6.27n): in the desktop app only, before any picture can be added.
  installHeicDecoder();

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
