import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../app/projectStore';
import { selectionStore, useSelection } from '../storyboard/selection';

// What the Player plays when it isn't the selected frame's clip (5.1b): the video of a board's video card. Its "playing"
// source is either kind: a frame's clip (the selection, as before) or a card's video. A card's holds only while the
// frame selected is the one that was when it was opened: selecting another frame hands the Player back to the frames,
// with nothing to clear. View state, never in the project.

export interface CardSource {
  /** The card's video `media` record. */
  videoId: string;
  /** The card's `board_item`, so the Player can tell when the card has gone. */
  itemId: string;
  /** The frame selected when the card was opened. */
  shotId: string | null;
}

const source = createStore<{ card: CardSource | null }>()(() => ({ card: null }));

/** Plays this video record in the Player (the tile itself is opened by the caller). */
export function playCard(videoId: string, itemId: string): void {
  source.setState({ card: { videoId, itemId, shotId: selectionStore.getState().shotId } });
}

// The Player goes back to the frames when another frame is selected, and when another project opens.
selectionStore.subscribe((state, before) => {
  if (state.shotId !== before.shotId && source.getState().card !== null) source.setState({ card: null });
});
projectStore.subscribe((state, before) => {
  if (state.project !== before.project && source.getState().card !== null) source.setState({ card: null });
});

/** The card's source if it still holds for this selected frame. */
export function cardFor(card: CardSource | null, shotId: string | null): CardSource | null {
  return card !== null && card.shotId === shotId ? card : null;
}

/** The card the Player is playing now, or null for the selected frame's clip. */
export function usePlayerCard(): CardSource | null {
  const card = useStore(source, (s) => s.card);
  const shotId = useSelection((s) => s.shotId);
  return cardFor(card, shotId);
}

/** Back to the frames (and for tests). */
export function clearCard(): void {
  source.setState({ card: null });
}

export function currentCard(): CardSource | null {
  return cardFor(source.getState().card, selectionStore.getState().shotId);
}
