import { useMemo, useState, type ReactNode } from 'react';
import { usePlanUnit } from '../../../app/planUnits';
import { useProject } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import { planFields, roomTitle, sceneRoom, wallEnds } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import { sceneSetups } from '../../../core/model/setup';
import { sceneFields, sceneLabel } from '../../../core/model/storyboard';
import { Button } from '../../../ui/Button';
import { Canvas } from '../../../ui/canvas/Canvas';
import { INK, PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { ToolStrip } from '../../../ui/canvas/ToolStrip';
import type { CanvasCommand } from '../../../ui/canvas/types';
import { Trans } from '../../../ui/Trans';
import {
  changePlanGeometry,
  copyPlanSelection,
  cutPlanSelection,
  deletePlanSelection,
  drawWalls,
  duplicatePlanSelection,
  nudgePlan,
  pastePlan,
  reorderPlan,
  startRoom,
  type PlanView,
} from './planActions';
import { planItemsBuilder, shownItemsKeeper, viewKey } from './planItems';
import { PLAN_TOOLS, PLAN_ZOOM, planScale, WALL_TOOL } from './planScale';
import { planStore, planViewportOf, usePlan } from './planStore';
import { useShownPlan } from './shownPlan';

// The Plan tile (6.2a), in the Setup workspace: the setup picked in the Setups tile (or a scene picked by its heading)
// as a top-down plan in real units, on paper in light and dark (decision 13). Its room is started here, then walls are
// drawn on it point to point with typed lengths. Everything the canvas reports becomes an edit in planActions.ts.

type Records = Readonly<Record<string, SbdRecord>>;

/** The view the Setup workspace shows, while its scene (and setup) are live. */
export function useLiveView(records: Records): { view: PlanView; scene: SbdRecord; setup: SbdRecord | null; number: number | null } | null {
  const { sceneId, setupId } = useShownPlan();
  if (sceneId === null) return null;
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return null;
  const setups = sceneSetups(records, sceneId);
  const setup = setupId === null ? undefined : setups.find((s) => s.record.id === setupId);
  return { view: { sceneId, setupId: setup ? setup.record.id : null }, scene, setup: setup?.record ?? null, number: setup?.number ?? null };
}

export function PlanTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const live = useLiveView(records);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('plan.noProject')}</p>;
  if (!live) return <p className="p-3 text-[13px] text-text-muted">{t('plan.pick')}</p>;
  const scene = sceneLabel(sceneFields(live.scene.props).number);
  const room = sceneRoom(records, live.scene.id);
  const name = live.setup && typeof live.setup.props.name === 'string' ? live.setup.props.name.trim() : '';
  const header = (
    <h2 data-plan-header="" className="min-w-0 truncate text-[13px] font-bold">
      <span className="font-mono">{scene}</span>
      {live.number !== null && (
        <>
          {' · '}
          <Trans k="setup.label" parts={{ number: <span className="font-mono">{live.number}</span> }} />
        </>
      )}
      {name !== '' && (
        <>
          {' · '}
          <span data-user-text="">{name}</span>
        </>
      )}
    </h2>
  );
  if (!room) {
    return (
      <div className="flex flex-col gap-3 p-3" data-plan-tile="">
        {header}
        <p className="text-[13px]">{t('plan.noRoom', { scene })}</p>
        <div>
          <Button
            variant="primary"
            data-start-room=""
            onClick={() => {
              void startRoom(live.scene.id);
            }}
          >
            {t('plan.startRoom')}
          </Button>
        </div>
      </div>
    );
  }
  // A canvas per view: nothing it holds (a run of walls being drawn above all) carries into another view. A run in
  // progress when the view changes ends as Escape ends it, written into the room it was drawn in.
  return <PlanCanvas key={viewKey(live.view.sceneId, live.view.setupId)} view={live.view} header={header} roomName={roomTitle(planFields(room.props))} />;
}

function PlanCanvas({ view, header, roomName }: { view: PlanView; header: ReactNode; roomName: string }) {
  const records = useProject((s) => s.records);
  const unit = usePlanUnit();
  const key = viewKey(view.sceneId, view.setupId);
  const stored = usePlan((s) => s.selections[key]);
  const viewports = usePlan((s) => s.viewports);
  const tool = usePlan((s) => s.tool);
  const clipboard = usePlan((s) => s.clipboard);
  // Read once per change of the records, and kept as they were while the plan's own records are (an edit elsewhere in
  // the project rebuilds nothing, and the canvas keeps what it drew for each wall).
  const [keepShown] = useState(shownItemsKeeper);
  const [build] = useState(planItemsBuilder);
  const shown = useMemo(() => keepShown(records, view.sceneId, view.setupId), [keepShown, records, view.sceneId, view.setupId]);
  const items = useMemo(() => build(shown, unit, INK), [build, shown, unit]);
  const scale = useMemo(() => planScale(unit), [unit]);
  // An undo that removed an item takes it out of the selection.
  const selection = useMemo(() => (stored ?? []).filter((id) => items.some((item) => item.id === id)), [stored, items]);
  // What the plan holds, in metres, as plain data for the end-to-end tests (the canvas is pixels).
  const data = useMemo(
    () =>
      JSON.stringify(
        shown.map(({ record, fields, level }) => {
          const [start, end] = wallEnds(fields);
          return { id: record.id, level, ...fields, start, end };
        }),
      ),
    [shown],
  );
  const run = (command: CanvasCommand) => {
    switch (command.kind) {
      case 'copy':
        copyPlanSelection(view);
        break;
      case 'cut':
        void cutPlanSelection(view);
        break;
      case 'paste':
        void pastePlan(view, command.at);
        break;
      case 'duplicate':
        void duplicatePlanSelection(view);
        break;
      case 'delete':
        void deletePlanSelection(view);
        break;
      case 'forward':
      case 'backward':
      case 'front':
      case 'back':
        void reorderPlan(view, command.kind);
        break;
      default:
        // Align, distribute, tidy and sections are a board's (5.3), not a plan's.
        break;
    }
  };
  return (
    <div className="flex h-full min-h-80 flex-col" data-plan-tile="">
      <ToolStrip tool={tool} onTool={planStore.getState().setTool} tools={PLAN_TOOLS}>
        {header}
      </ToolStrip>
      <div className="min-h-0 min-w-0 flex-1" data-plan-data={data} data-plan-unit={unit}>
        <Canvas
          label={t('plan.canvasLabel', { name: roomName })}
          items={items}
          selection={selection}
          onSelectionChange={(ids) => {
            planStore.getState().select(key, ids);
          }}
          tool={tool}
          onToolChange={planStore.getState().setTool}
          viewport={planViewportOf(viewports, key)}
          onViewportChange={(next) => {
            planStore.getState().setViewport(key, next);
          }}
          onGeometry={(changes) => changePlanGeometry(changes)}
          onNudge={(ids, dx, dy) => nudgePlan(ids, dx, dy)}
          // A plan has no click-to-place tool yet (6.3's library brings them).
          onCreate={() => undefined}
          onPath={(points, used) => (used === WALL_TOOL ? drawWalls(view, points) : undefined)}
          onCommand={run}
          canPaste={clipboard.length > 0}
          fixedColours={PAPER_COLOURS}
          tools={PLAN_TOOLS}
          scale={scale}
          zoomLimits={PLAN_ZOOM}
        />
      </div>
    </div>
  );
}
