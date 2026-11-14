import { useProject } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import { lensLabel, projectBodies, projectLenses, rangeMessage, type BodyFields } from '../../../core/model/cameraGear';
import { oneDecimal } from '../../../core/model/fieldOfView';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { parseDegrees, type CameraFields } from '../../../core/model/plan';
import {
  cameraBody,
  cameraCone,
  cameraFrames,
  cameraHeight,
  cameraLens,
  cameraLensRefusal,
  cameraSetupId,
  cameraTitle,
  frameCamera,
  framesDiffering,
  shownFrame,
} from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { setupFrames } from '../../../core/model/setup';
import { choiceLabel, HEIGHT_LABEL, shotFields, specLine } from '../../../core/model/storyboard';
import { Button } from '../../../ui/Button';
import { Select, Toggle } from '../../../ui/fields';
import { Trans } from '../../../ui/Trans';
import { showShot } from '../../moodboards/liveActions';
import { iconLabel } from './iconWords';
import { changeIcons, linkFrame, pickCameraLens, setCameraBody, setOnSide, showFrame, typeCameraLens, unlinkFrame, takeFrameLens } from './planActions';
import { iconCentre, iconPatchRefused, type IconPatch } from './planItems';
import { degreesText, lengthCommit, TypedField } from './selectionFields';

// A camera in the Selection tile (6.4, decisions 4 to 6 and 11): its body (the project's bodies by letter, or the
// default body, read live), the frames shot from it (the one whose lens the cone draws marked; link, unlink, show), its
// lens (read only from the shown frame, with a way to change it on the board; typed, with a lens picked, while it has
// no frame), On its side, its height (the shown frame's wins), its rotation and middle, and the field of view as the
// Inspector shows it. The lens check (src/core/checks) shows here with a button that takes the typed lens off.

type Records = Readonly<Record<string, SbdRecord>>;

const ACTION = 'sb-label h-6 border border-text px-1.5 hover:bg-surface-raised focus-visible:-outline-offset-4';

/** A body as the choice names it: "A cam · FX3", or its name (else its mode) without a letter. */
function bodyName(body: { record: SbdRecord; fields: BodyFields }): string {
  const name = typeof body.record.props.name === 'string' ? body.record.props.name.trim() : '';
  const what = name !== '' ? name : body.fields.sensorMode !== '' ? body.fields.sensorMode : t('gear.kind.camera_body');
  return body.fields.letter ? t('selection.camera.bodyLettered', { letter: body.fields.letter, name: what }) : what;
}

const frameNumber = (shot: SbdRecord): string => shotFields(shot.props).number;

export function CameraFieldsView({ id, fields, unit, records }: { id: string; fields: CameraFields; unit: PlanUnit; records: Records }) {
  const project = useProject((s) => s.project);
  const record = records[id];
  if (!project || !record) return null;
  const projectId = project.projectId;
  const body = cameraBody(records, record);
  const bodies = projectBodies(records, projectId);
  const frames = cameraFrames(records, id);
  const shown = shownFrame(records, id);
  const lens = cameraLens(records, id);
  const height = cameraHeight(records, id);
  const cone = cameraCone(records, id);
  const differing = framesDiffering(records, id);
  const setupId = cameraSetupId(records, record);
  const linkable = (setupId ? setupFrames(records, setupId) : []).filter((shot) => !frames.some((f) => f.id === shot.id));
  const centre = iconCentre(fields);
  const keyed = (field: string) => `${id}:${field}`;
  const write = (patch: IconPatch): boolean => {
    if (iconPatchRefused(records, [id], patch)) return false;
    void changeIcons([id], patch);
    return true;
  };
  const length = (apply: (m: number) => IconPatch, opts: { signed?: boolean; empty?: IconPatch } = {}) => lengthCommit(unit, write, apply, opts);
  const refused = t('selection.lengthRefused');
  const defaultBody = body?.isDefault ? body : (bodies[0] ? { ...bodies[0], isDefault: true } : null);
  return (
    <div className="flex flex-col gap-3" data-camera={id}>
      <p className="sb-label" data-selection-kind="">
        {cameraTitle(records, id, iconLabel)}
      </p>
      <TypedField key={keyed('name')} label={t('selection.name')} mono={false} text={fields.name} onCommit={(typed) => write({ name: typed.trim() })} />
      <Select
        label={t('selection.camera.body')}
        value={fields.bodyId !== null && body && !body.isDefault ? body.record.id : ''}
        onChange={(event) => {
          const next = event.currentTarget.value;
          void setCameraBody(id, next === '' ? null : next);
        }}
      >
        <option value="">{defaultBody ? t('selection.camera.defaultBodyIs', { body: bodyName(defaultBody) }) : t('selection.camera.defaultBody')}</option>
        {bodies.map((b) => (
          <option key={b.record.id} value={b.record.id}>
            {bodyName(b)}
          </option>
        ))}
      </Select>
      <FramesList cameraId={id} frames={frames} shown={shown} linkable={linkable} records={records} hasSetupFrames={setupId !== null && (frames.length > 0 || linkable.length > 0)} />
      <LensFields cameraId={id} lens={lens} records={records} projectId={projectId} />
      {differing.length > 0 && (
        <div className="flex flex-col gap-2 border border-text p-2" data-lens-check="" role="group" aria-label={t('selection.camera.lensCheck')}>
          {differing.map((d) => (
            <p key={d.shot.id} className="text-[13px] text-warning dark:text-text">
              <Trans
                k="selection.camera.lensDiffers"
                parts={{
                  frame: <span className="font-mono">{frameNumber(d.shot)}</span>,
                  frameMm: <span className="font-mono">{t('lens.prime', { mm: d.frameMm })}</span>,
                  cameraMm: <span className="font-mono">{t('lens.prime', { mm: d.cameraMm })}</span>,
                }}
              />
            </p>
          ))}
          <div>
            <Button variant="secondary" data-use-frame-lens="" onClick={() => void takeFrameLens(id)}>
              {t('selection.camera.useFrameLens')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-[5px]" data-camera-fov="">
        <span className="sb-label">{t('inspector.fieldOfView')}</span>
        {!cone || 'missing' in cone ? (
          <p className="text-[12px] text-text-muted">
            {t(!cone || cone.missing === 'noBody' ? 'inspector.fovNoBody' : cone.missing === 'noSensor' ? 'inspector.fovNeedsSensor' : 'selection.camera.fovNeedsLens')}
          </p>
        ) : (
          <p className="font-mono text-[13px]">
            {t('inspector.fov', { degrees: oneDecimal(cone.degrees), width: oneDecimal(cone.widthMm), sensorWidth: oneDecimal(cone.sensorWidthMm), sensorHeight: oneDecimal(cone.sensorHeightMm) })}
          </p>
        )}
      </div>
      <Toggle label={t('selection.camera.onSide')} checked={fields.onSide} onChange={(on) => void setOnSide([id], on)} />
      {height?.from === 'frame' ? (
        <div className="flex flex-col gap-[5px]" data-camera-height="frame">
          <span className="sb-label">{t('selection.height')}</span>
          <p className="text-[13px]">{choiceLabel(HEIGHT_LABEL, height.value)}</p>
          <p className="text-[12px] text-text-muted">
            <Trans k="selection.camera.heightFromFrame" parts={{ frame: <span className="font-mono">{frameNumber(height.shot)}</span> }} />
          </p>
        </div>
      ) : (
        <TypedField
          key={keyed('height')}
          label={t('selection.height')}
          text={fields.heightM === null ? '' : formatLength(fields.heightM, unit)}
          onCommit={length((m) => ({ heightM: m }), { empty: { heightM: null } })}
          refused={refused}
        />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField
          key={keyed('rotation')}
          label={t('selection.rotation')}
          text={degreesText(fields.rotation)}
          onCommit={(typed) => {
            const degrees = parseDegrees(typed);
            if (degrees === null) return false;
            return write({ rotation: degrees });
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField key={keyed('x')} label={t('selection.x')} text={formatLength(centre.x, unit)} onCommit={length((m) => ({ centreX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={formatLength(centre.y, unit)} onCommit={length((m) => ({ centreY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.camera.note')}</p>
    </div>
  );
}

/** The frames shot from the camera, the shown one marked, each to show or unlink; and a choice of the setup's others to link. */
function FramesList({
  cameraId,
  frames,
  shown,
  linkable,
  records,
  hasSetupFrames,
}: {
  cameraId: string;
  frames: readonly SbdRecord[];
  shown: SbdRecord | null;
  linkable: readonly SbdRecord[];
  records: Records;
  hasSetupFrames: boolean;
}) {
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby={`camera-frames-${cameraId}`} data-camera-frames="">
      <h3 id={`camera-frames-${cameraId}`} className="sb-label">
        {t('selection.camera.frames')}
      </h3>
      {frames.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t(hasSetupFrames ? 'selection.camera.noFrames' : 'selection.camera.noSetupFrames')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {frames.map((shot) => {
            const number = frameNumber(shot);
            const isShown = shot.id === shown?.id;
            const spec = specLine(shotFields(shot.props));
            return (
              <li key={shot.id} className="flex flex-wrap items-center gap-1.5 text-[13px]" data-camera-frame={shot.id} data-shown={isShown ? 'true' : undefined}>
                <span className="font-mono font-bold">{number}</span>
                {spec !== '' && <span className="font-mono text-[12px]">{spec}</span>}
                {isShown ? (
                  <span className="sb-label ml-auto">{t('selection.camera.shownMark')}</span>
                ) : (
                  <button type="button" className={`${ACTION} ml-auto`} aria-label={t('selection.camera.showNamed', { frame: number })} onClick={() => void showFrame(cameraId, shot.id)}>
                    {t('selection.camera.show')}
                  </button>
                )}
                <button type="button" className={ACTION} data-unlink-frame={shot.id} aria-label={t('selection.camera.unlinkNamed', { frame: number })} onClick={() => void unlinkFrame(cameraId, shot.id)}>
                  {t('selection.camera.unlink')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {linkable.length > 0 && (
        <Select
          label={t('selection.camera.link')}
          mono
          value=""
          onChange={(event) => {
            const shotId = event.currentTarget.value;
            if (shotId !== '') void linkFrame(cameraId, shotId);
          }}
        >
          <option value="">{t('selection.camera.linkPick')}</option>
          {linkable.map((shot) => {
            const holder = frameCamera(records, shot.id);
            const number = frameNumber(shot);
            return (
              <option key={shot.id} value={shot.id}>
                {holder ? t('selection.camera.linkFromOther', { frame: number, camera: cameraTitle(records, holder, iconLabel) }) : number}
              </option>
            );
          })}
        </Select>
      )}
    </section>
  );
}

/** The lens: read only from the shown frame, changed on the board; typed on the camera, with a lens picked, while it has no frame. */
function LensFields({ cameraId, lens, records, projectId }: { cameraId: string; lens: ReturnType<typeof cameraLens>; records: Records; projectId: string }) {
  if (!lens) return null;
  if (lens.from === 'frame' && lens.shot) {
    const shot = lens.shot;
    return (
      <div className="flex flex-col gap-[5px]" data-camera-lens="frame">
        <span className="sb-label">{t('inspector.lens')}</span>
        <p className="font-mono text-[13px]">
          {lens.mm === null ? t('selection.camera.noFocal') : t('lens.prime', { mm: lens.mm })}
          {lens.lens && ` · ${lensLabel(lens.lens)}`}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
          <Trans k="selection.camera.lensFromFrame" parts={{ frame: <span className="font-mono">{frameNumber(shot)}</span> }} />
          <button type="button" className={ACTION} data-change-on-board={shot.id} onClick={() => {
            showShot(shot.id, shot.parentId);
          }}>
            {t('selection.camera.changeOnBoard')}
          </button>
        </p>
      </div>
    );
  }
  const lenses = projectLenses(records, projectId);
  return (
    <div className="flex flex-col gap-3" data-camera-lens="camera">
      {lenses.length > 0 && (
        <Select
          label={t('inspector.lens')}
          mono
          value={lens.lens?.record.id ?? ''}
          onChange={(event) => {
            const next = event.currentTarget.value;
            void pickCameraLens(cameraId, next === '' ? null : next);
          }}
        >
          <option value="">{t('inspector.noLens')}</option>
          {lenses.map((l) => (
            <option key={l.record.id} value={l.record.id}>
              {lensLabel(l)}
            </option>
          ))}
        </Select>
      )}
      <TypedField
        key={`${cameraId}:lens`}
        label={t('selection.camera.focal')}
        text={lens.mm === null ? '' : String(lens.mm)}
        onCommit={(typed) => {
          const trimmed = typed.trim();
          if (trimmed === '') {
            // A lens picked always has its focal length.
            if (lens.lens?.fields.range) return rangeMessage(lens.lens.fields.range);
            void typeCameraLens(cameraId, null);
            return true;
          }
          const mm = Number(trimmed.replace(/\s*mm$/i, '').replace(',', '.'));
          const why = cameraLensRefusal(records, cameraId, mm);
          if (why === 'notFocal') return t('inspector.lensProblem');
          if (why) return rangeMessage(why.range);
          void typeCameraLens(cameraId, mm);
          return true;
        }}
      />
      <p className="text-[12px] text-text-muted">{t('selection.camera.lensNote')}</p>
    </div>
  );
}
