import { Fragment, type ReactNode } from 'react';
import { t, type MessageKey } from '../core/i18n';

/**
 * A translated sentence with parts that are elements: a bold size, a key in <kbd>, a name in mono. The whole sentence
 * stays one message, so a translation can put the parts in its own word order. `{name}` in the message takes
 * parts[name]; strings and numbers fill in as plain text.
 */
export function Trans({ k, parts }: { k: MessageKey; parts: Readonly<Record<string, ReactNode>> }) {
  // Placeholders are swapped for markers, so t() fills the plain values and the elements go in afterwards.
  const plain: Record<string, string> = {};
  for (const name of Object.keys(parts)) plain[name] = `\u0000${name}\u0000`;
  const pieces = t(k, plain).split('\u0000');
  return (
    <>
      {pieces.map((piece, i) =>
        // Odd pieces are placeholder names.
        i % 2 === 1 ? <Fragment key={i}>{parts[piece]}</Fragment> : piece,
      )}
    </>
  );
}
