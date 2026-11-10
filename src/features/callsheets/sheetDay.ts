import { create } from 'zustand';

// The day the Call sheet tile shows (4.1), kept in memory only, never in the project. It lives here so that "N checks"
// in the Shoot days tile (4.8) can open the call sheet on a day. An id that isn't a live day of the open project is
// ignored by the tile, which then starts on its default day.

export const useSheetDay = create<{ dayId: string | null }>(() => ({ dayId: null }));

export const showSheetDay = (dayId: string): void => {
  useSheetDay.setState({ dayId });
};
