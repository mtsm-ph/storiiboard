import { linkUrl } from '../../core/model/attachment';

// Link cards (5.1b): an address and an optional title. Nothing here reaches the network: a card shows what a person
// typed, or the address's own host and path, and never a title or preview fetched from the page.

/** A web address a link card can keep: http or https only (javascript:, file: and the rest are refused), or null. */
export const cardUrl = (typed: string): string | null => linkUrl(typed);

/**
 * Pasted text that is one web address: written out with http:// or https://, nothing else in it. A bare word or a
 * sentence is text, not a link, so it is never taken for one.
 */
export function pastedAddress(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return linkUrl(trimmed);
}

/** What a card calls itself: its title, else the host and path of its address (no scheme, no trailing slash). */
export function linkLabel(url: string, title: string): string {
  if (title.trim() !== '') return title;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}
