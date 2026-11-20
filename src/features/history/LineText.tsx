import type { Line } from './summary';

/** A step's line, its technical values in mono. Notifications (3.10) and the top bar's Undo and Redo show the same. */
export function LineText({ line }: { line: Line }) {
  return (
    <>
      {line.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="font-mono">
            {part.mono}
          </span>
        ),
      )}
    </>
  );
}
