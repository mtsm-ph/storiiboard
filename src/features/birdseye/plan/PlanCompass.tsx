import { useEffect, useId, useRef, useState } from 'react';
import { layoutsOf, layoutStore } from '../../../app/shell/docking/layoutStore';
import { openTile } from '../../../app/shell/docking/layout';
import { useWorkspaceId } from '../../../app/shell/workspaceContext';
import { t } from '../../../core/i18n';
import { compassModel, type CompassModel } from '../../../core/model/planCompass';
import { roomNorthItem } from '../../../core/model/planSun';
import { sceneRoomId } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import { Button } from '../../../ui/Button';
import { useForwardToCanvas } from '../../../ui/canvas/forwardToCanvas';
import { RULER_SIZE } from '../../../ui/canvas/Rulers';
import { cx } from '../../../ui/cx';
import { degreesText } from './selectionFields';
import { selectPlanItems, type PlanView } from './planActions';
import { MISSING_WORDS, shownHeight } from './sunLooks';

// The compass at the plan's top-right corner (6.5.5, Kevin Nov 16): on screen only, app chrome over the canvas as the
// tool strip is (it follows the app's theme over a Paper or a Dark canvas, on its own boxed surface; it is no item and
// never printed: a printed plan keeps its own north). It shows north as the room has it, turning with it, and the sun
// for the plan's date by the sun path's one reading (sunSources.ts): the arc from sunrise to sunset round its rim and
// the sun's direction at the sun path's time (solar noon for one with no time of its own, said so). "N?" with no north;
// north alone with no place or date. It is a button: it selects the room's north and the setup's sun path, so the
// Selection tile shows their settings (opened when it isn't); with no sun path, it offers "Add sun path".
//
// Where it sits: inside the top ruler (RULER_SIZE + 8 px down), 8 px from the right edge, so it never meets the zoom's
// box or the Paper/Dark and Trackpad row (both at the bottom-left, beside the left ruler), the minimap's button (the
// bottom-right), or the tool strip (the top-left). Layering, with the strip's (ToolStrip.tsx): the canvas and its own
// overlays (z-10 and under), then the strip and the compass (z-[15]), their panels (z-30, inside their own layer), then
// the canvas's menus (z-20). A wheel or a middle press on it is the canvas's (useForwardToCanvas), and while a drawing
// tool is in use the pointer goes through it to the plan. The host renders it just after the canvas, so its tab stop
// comes after the canvas's (Shift+Tab from the canvas still reaches the strip's last tool first).

type Records = Readonly<Record<string, SbdRecord>>;

/** The dial's side and its rim, px. */
const SIZE = 64;
const MIDDLE = SIZE / 2;
const RIM = 26;
/** Where the arc, the sun and north's letter sit from the middle, px. */
const ARC = 21;
const LETTER = 16;

/** "North is 35°. Sun: 212° at 14:30, 38° high", the compass's accessible name. */
export function compassName(model: CompassModel): string {
  const north = model.north === null ? t('compass.northUnset') : degreesText(Math.round(model.north) % 360);
  return t('compass.label', { north, sun: sunWords(model) });
}

/** What the compass says of the sun. */
export function sunWords(model: CompassModel): string {
  if (model.pending) return t('compass.pending');
  if (model.missing === 'noSunPath') return t('compass.noSunPath');
  if (model.missing !== null) return t(MISSING_WORDS[model.missing]);
  const sun = model.sun;
  if (!sun) return t('compass.noSunPath');
  const noon = sun.timeFrom === 'solarNoon';
  if (!sun.at.up) return t(noon ? 'compass.sunDownNoon' : 'compass.sunDown', { time: sun.at.time });
  const values = { bearing: degreesText(Math.round(sun.at.bearing) % 360), time: sun.at.time, height: String(shownHeight(sun.at.altitude)) };
  return t(noon ? 'compass.sunAtNoon' : 'compass.sunAt', values);
}

const at = (v: { x: number; y: number }, r: number) => ({ x: MIDDLE + v.x * r, y: MIDDLE + v.y * r });

/** The dial: rim, north's arrow and letter (or "N?"), the sun's arc and the sun. Drawn in the app's text colour. */
function Dial({ model }: { model: CompassModel }) {
  const arrow = model.northArrow;
  const tip = arrow ? at(arrow, RIM - 3) : null;
  const tail = arrow ? at({ x: -arrow.x, y: -arrow.y }, RIM - 12) : null;
  const letter = arrow ? at(arrow, LETTER) : null;
  const sun = model.sun;
  const sunAt = sun ? at(sun.at, ARC) : null;
  return (
    <svg aria-hidden="true" width={SIZE} height={SIZE} viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`} className="block">
      <circle cx={MIDDLE} cy={MIDDLE} r={RIM} fill="none" stroke="currentColor" strokeWidth={1.5} />
      {sun && sun.arc.length > 1 && (
        <polyline
          data-compass-arc=""
          points={sun.arc.map((p) => `${String(Math.round((MIDDLE + p.x * ARC) * 10) / 10)},${String(Math.round((MIDDLE + p.y * ARC) * 10) / 10)}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      {tip && tail && <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} stroke="currentColor" strokeWidth={1.5} />}
      {tip && arrow && (
        // The arrowhead: a small triangle at the tip, pointing north.
        <polygon
          points={[tip, at({ x: arrow.x * 0.8 - arrow.y * 0.25, y: arrow.y * 0.8 + arrow.x * 0.25 }, RIM - 3), at({ x: arrow.x * 0.8 + arrow.y * 0.25, y: arrow.y * 0.8 - arrow.x * 0.25 }, RIM - 3)]
            .map((p) => `${String(p.x)},${String(p.y)}`)
            .join(' ')}
          fill="currentColor"
        />
      )}
      {letter ? (
        <text x={letter.x} y={letter.y} textAnchor="middle" dominantBaseline="central" className="font-mono text-[10px] font-bold" fill="currentColor">
          {t('compass.n')}
        </text>
      ) : (
        <text x={MIDDLE} y={MIDDLE} textAnchor="middle" dominantBaseline="central" className="font-mono text-[12px] font-bold" fill="currentColor">
          {t('compass.unknownNorth')}
        </text>
      )}
      {sunAt && sun && (
        <>
          <line x1={MIDDLE} y1={MIDDLE} x2={sunAt.x} y2={sunAt.y} stroke="currentColor" strokeWidth={1} />
          {/* Up: a filled disc; down: a ring (a second cue besides the words). */}
          <circle data-compass-sun={sun.at.up ? 'up' : 'down'} cx={sunAt.x} cy={sunAt.y} r={4} fill={sun.at.up ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

interface PlanCompassProps {
  records: Records;
  view: PlanView;
  /** The sun paths' zones as the plan has them (useSunZonesAt). */
  zones: ReadonlyMap<string, string | null>;
  /** Puts a sun path in the middle of the view (the Library's own placing). */
  onAddSun: () => void;
  /**
   * A drawing tool is in use (a wall, a measure, a camera…): the pointer goes through the compass to the plan, so a
   * point clicked in the plan's top-right corner lands there. The keyboard still reaches it.
   */
  passThrough: boolean;
}

export function PlanCompass({ records, view, zones, onAddSun, passThrough }: PlanCompassProps) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [offer, setOffer] = useState(false);
  const panel = useId();
  const workspaceId = useWorkspaceId();
  useForwardToCanvas(root);
  const model = compassModel(records, view, zones);
  // The offer closes by a press outside or by Escape (the focus back to the compass), and shows only while there is no
  // sun path to open.
  useEffect(() => {
    if (!offer) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOffer(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointerdown', onDown);
    };
  }, [offer]);
  const open = () => {
    const north = roomNorthItem(records, sceneRoomId(records, records[view.sceneId]))?.record.id ?? null;
    const ids = [north, model.sunId].filter((id): id is string => id !== null);
    if (ids.length > 0) selectPlanItems(view, ids);
    // The Selection tile shows their settings: opened in this workspace when it isn't.
    if (!document.querySelector('[data-selection-tile]')) {
      const { layouts, change } = layoutStore.getState();
      change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'selection'));
    }
    if (model.sunId === null) setOffer((was) => !was);
  };
  const name = compassName(model);
  const noon = model.sun?.timeFrom === 'solarNoon';
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the offer; the buttons inside are the controls
    <div
      ref={root}
      data-plan-compass=""
      data-compass-north={model.north === null ? 'unset' : String(model.north)}
      data-compass-sun={model.sun ? (model.sun.at.up ? 'up' : 'down') : (model.missing ?? 'pending')}
      className={cx('absolute right-2 z-[15] flex flex-col items-end', passThrough && 'pointer-events-none')}
      data-compass-pass-through={passThrough ? '' : undefined}
      style={{ top: RULER_SIZE + 8 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && offer) {
          event.stopPropagation();
          setOffer(false);
          button.current?.focus();
        }
      }}
    >
      {/* The dial and its time sit beside the button, under it, not in it (as a tool's icon does, ToolStrip.tsx): their
          letters ("N", the time) would be read as the button's visible label, which its name must contain (WCAG 2.5.3). */}
      <div className="relative border-[1.5px] border-text bg-surface p-0.5 text-text hover:bg-surface-raised">
        <span aria-hidden="true" className="pointer-events-none flex flex-col items-center">
          <Dial model={model} />
          {model.sun && (
            <span className="font-mono text-[10px] leading-none font-bold" data-compass-time={noon ? 'solarNoon' : 'item'}>
              {noon ? t('compass.captionNoon', { time: model.sun.at.time }) : model.sun.at.time}
            </span>
          )}
        </span>
        <button
          ref={button}
          type="button"
          aria-label={name}
          aria-expanded={model.sunId === null ? offer : undefined}
          aria-controls={model.sunId === null && offer ? panel : undefined}
          data-compass-button=""
          className="absolute inset-0 focus-visible:-outline-offset-4"
          onClick={open}
        />
      </div>
      {offer && model.sunId === null && (
        <div id={panel} role="group" aria-label={t('compass.title')} className="pointer-events-auto z-30 mt-1 flex w-56 flex-col gap-2 border-[1.5px] border-text bg-surface p-2 text-text" data-compass-offer="">
          <p className="text-[12px]">{view.setupId === null ? t('compass.noSetup') : t('compass.noSunHere')}</p>
          {view.setupId !== null && (
            <div>
              <Button
                data-compass-add-sun=""
                onClick={() => {
                  setOffer(false);
                  onAddSun();
                }}
              >
                {t('compass.addSunPath')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
