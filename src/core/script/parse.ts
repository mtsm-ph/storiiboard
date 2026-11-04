import { parseFdx } from './fdx';
import { parseFountain } from './fountain';
import type { Script } from './script';

/** A script file's scenes, by what's in it: Final Draft's XML, or Fountain (also .spmd and plain .txt). */
export function parseScript(text: string): Script {
  return /^\s*(?:<\?xml[^>]*>\s*)?<FinalDraft\b/.test(text.replace(/^\uFEFF/, '')) ? parseFdx(text) : parseFountain(text);
}
