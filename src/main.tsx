import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './app/App';
import { setLocale } from './core/i18n';
import { loadSettings } from './core/storage/settings';

// The person's language before the first render, so nothing draws in English first.
setLocale(loadSettings().language);

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
