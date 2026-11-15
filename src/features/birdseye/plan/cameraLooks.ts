import { t } from '../../../core/i18n';
import { oneDecimal } from '../../../core/model/fieldOfView';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import type { ShownItem } from '../../../core/model/plan';
import { cameraCone, cameraHeight, isTrackIcon, liveCamera, type CameraCone, type CameraHeight } from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { choiceLabel, HEIGHT_LABEL } from '../../../core/model/storyboard';
import type { CameraLook } from './cameraDraw';

// What each camera on a plan shows past its box (6.4), worked out from the records each time they change: its cone's
// angle and its labels. Read live from its frames, body and the project (planCamera.ts), never stored, so a lens
// changed on the board changes the plan with no edit to it.

type Records = Readonly<Record<string, SbdRecord>>;

/** "A · 50 mm · 51.1°", or what is missing for a cone: "No camera body", "A · No focal length". */
export function coneLabel(cone: CameraCone | null): string {
  if (!cone) return '';
  const lead = (words: string) => (cone.letter ? t('plan.camera.missingFor', { letter: cone.letter, what: words }) : words);
  if ('missing' in cone) {
    if (cone.missing === 'noBody') return t('plan.camera.noBody');
    return lead(t(cone.missing === 'noSensor' ? 'plan.camera.noSensor' : 'plan.camera.noFocal'));
  }
  const values = { mm: String(cone.focalMm), degrees: oneDecimal(cone.degrees) };
  return cone.letter ? t('plan.camera.label', { letter: cone.letter, ...values }) : t('plan.camera.labelNoLetter', values);
}

/** A set height as its label: "1.50 m", 4' 11", or the frame's choice ("Eye level") when the frame's wins. */
export function heightLabel(height: CameraHeight, unit: PlanUnit): string | null {
  if (!height) return null;
  return height.from === 'frame' ? choiceLabel(HEIGHT_LABEL, height.value) : formatLength(height.metres, unit);
}

/** A track's, slider's or jib's length (6.7), its longer side: "3.00 m track"; null for any other camera. */
export function trackLabel(fields: { icon: string; width: number; height: number }, unit: PlanUnit): string | null {
  return isTrackIcon(fields.icon) ? t('plan.camera.track', { length: formatLength(Math.max(fields.width, fields.height), unit) }) : null;
}

/** One camera's look. */
export function cameraLookOf(records: Records, cameraId: string, unit: PlanUnit, selected: boolean): CameraLook {
  const camera = liveCamera(records, cameraId);
  const cone = cameraCone(records, cameraId);
  const height = heightLabel(cameraHeight(records, cameraId), unit);
  const lines = [camera?.fields.name ?? '', coneLabel(cone), camera ? (trackLabel(camera.fields, unit) ?? '') : '', height ?? ''].filter((line) => line !== '');
  return { degrees: cone && !('missing' in cone) ? cone.degrees : null, lines, selected };
}

/** Every shown camera's look, by id. */
export function cameraLooks(records: Records, shown: readonly ShownItem[], unit: PlanUnit, selection: readonly string[]): Map<string, CameraLook> {
  const picked = new Set(selection);
  return new Map(shown.flatMap((item) => (item.fields.kind === 'camera' ? [[item.record.id, cameraLookOf(records, item.record.id, unit, picked.has(item.record.id))] as const] : [])));
}
