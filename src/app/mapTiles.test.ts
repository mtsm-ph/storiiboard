import { describe, expect, it } from 'vitest';
import { tilesOnline, tileProblem } from './mapTiles';

// The map's tile bridge (4.9): why a tile didn't come, said in the app's words; and a browser build asks for none.

describe('why a tile did not come', () => {
  it('words a service the switch turned off by its reason code', () => {
    expect(tileProblem('service-off:maintenance')).toBe('Turned off for now while the service is changed');
    expect(tileProblem(new Error('service-off:who-knows'))).toBe('Turned off for now');
  });

  it('words a lost connection and a busy server as every online feature does', () => {
    expect(tileProblem("Storiiboard couldn't reach the service. Check the connection and try again.")).toContain('Check the connection');
    expect(tileProblem('The service is busy. Try again in a minute.')).toContain('busy');
  });

  it('passes anything else on as it came', () => {
    expect(tileProblem('Some other trouble.')).toBe('Some other trouble.');
  });

  it('is a browser build in tests, which contacts no tile server', () => {
    expect(tilesOnline).toBe(false);
  });
});
