import { focusWhenShown } from '../../app/focusWhenShown';
import { projectStore } from '../../app/projectStore';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import { showWorkspace } from '../../app/shell/workspaceStore';
import type { WorkspaceId } from '../../app/shell/workspaces';
import type { CheckFinding } from '../../core/checks';
import { callSheet } from '../../core/model/callsheet';
import { revealLayersOf } from '../birdseye/plan/layersStore';
import { viewKey } from '../birdseye/plan/planItems';
import { planStore } from '../birdseye/plan/planStore';
import { showPlan } from '../birdseye/plan/shownPlan';
import { findingTarget } from '../callsheets/checkWords';
import { showSheetDay } from '../callsheets/sheetDay';
import { openLocation } from '../locations/shownLocation';
import { showShot } from '../moodboards/liveActions';

// Show, from the Checks tile (7.4): to where a finding is seen or fixed, as the call sheet strip's Show and the other
// tiles' links go. A frame is selected on the storyboard (as the Frames tile's link does); a plan's items, a camera
// among them, are selected on their setup's plan in the Setup section (as the Inspector's lens line does); a location
// opens in the Locations tile of this workspace; anything else opens the day's call sheet in this workspace with focus
// where its strip's Show puts it.

/** The one on screen: another workspace's copy, or a hidden one, isn't it. */
const shown = (selector: string): HTMLElement | null => [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.offsetParent !== null) ?? null;

export function showFinding(found: CheckFinding, workspaceId: WorkspaceId, projectId: string): void {
  const { target } = found;
  switch (target.kind) {
    case 'shot':
      showShot(target.shotId, target.sceneId);
      return;
    case 'plan':
      showPlan(target.sceneId, target.setupId);
      // Their layers shown and unlocked first, with the usual notice (6.8 review, M1), so what is selected can be seen.
      revealLayersOf(target.itemIds);
      planStore.getState().select(viewKey(target.sceneId, target.setupId), [...target.itemIds]);
      showWorkspace('setup');
      return;
    case 'location':
      openLocation(workspaceId, target.locationId);
      return;
    case 'sheet': {
      showSheetDay(target.dayId);
      const { layouts, change } = layoutStore.getState();
      change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'sheet'));
      // Where the strip's own Show goes, worked out from the sheet as it is now; the day's picker when that isn't there.
      const sheet = callSheet(projectStore.getState().records, projectId, target.dayId);
      const canAddPeople = sheet ? (sheet.peopleChosen ? sheet.notOnDay.length > 0 : !sheet.peopleOdd) : false;
      const inSheet = found.finding.kind === 'gear-not-on-day' || found.finding.kind === 'plan-lens-differs' ? null : findingTarget(found.finding, canAddPeople, sheet?.peopleOdd ?? false);
      focusWhenShown((last) => {
        const box = shown('[data-call-sheet]');
        // The tile may still show the day it had for a frame: only once it shows this day is the target the finding's.
        const onDay = box?.querySelector<HTMLSelectElement>('[data-day-select]')?.value === target.dayId;
        const element = box && onDay && inSheet ? box.querySelector<HTMLElement>(inSheet) : null;
        if (element) element.scrollIntoView({ block: 'nearest' });
        return element ?? (last || (onDay && !inSheet) ? (box?.querySelector<HTMLElement>('[data-day-select]') ?? null) : null);
      });
      return;
    }
  }
}
