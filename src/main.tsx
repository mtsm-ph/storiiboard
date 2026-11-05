import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './app/App';
import { setLocale } from './core/i18n';
import { loadSettings } from './core/storage/settings';
import { installTabWrap } from './ui/tabWrap';
import { fileMode } from './app/fileAccess';

// The person's language before the first render, so nothing draws in English first.
setLocale(loadSettings().language);

// Tab goes round the page or the top window, never out of it: the desktop webview has nowhere else to go. Not in a
// plain browser build (the web companion to come), where Tab should still reach the browser's own toolbar.
if (fileMode !== 'none') installTabWrap();

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
