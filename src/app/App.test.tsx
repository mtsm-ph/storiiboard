import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  it('renders the app name as the page heading', () => {
    expect(renderToString(<App />)).toMatch(/<h1[^>]*>Storiiboard<\/h1>/);
  });
});
