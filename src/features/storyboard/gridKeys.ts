// Moving through the board with the arrow keys. Left and Right go to the previous and next item in board order,
// across scene groups; Up and Down go to the item in the row above or below that sits nearest the same place across,
// the way a grid of photos behaves. Worked out from where the items are on screen, because how many fit in a row
// depends on the tile's width.

export interface ItemBox {
  left: number;
  top: number;
  width: number;
}

/** The index of the item Up (-1) or Down (1) should go to from `current`, or null at the top or bottom. */
export function verticalNeighbour(items: readonly ItemBox[], current: number, direction: -1 | 1): number | null {
  const from = items[current];
  if (!from) return null;
  const centre = from.left + from.width / 2;
  // The nearest row above or below: the closest top that's clearly past this item's.
  const rows = items
    .map((item) => item.top)
    .filter((top) => (direction === 1 ? top > from.top + 1 : top < from.top - 1));
  if (rows.length === 0) return null;
  const rowTop = direction === 1 ? Math.min(...rows) : Math.max(...rows);
  let best: number | null = null;
  let bestDistance = Infinity;
  items.forEach((item, i) => {
    if (Math.abs(item.top - rowTop) > 1) return;
    const distance = Math.abs(item.left + item.width / 2 - centre);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
