import { useProject } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { parseDegrees, type MarkFields } from '../../../core/model/plan';
import { cameraPositions, markNotes, markOwner, moveLength, sceneCharacterIds, viewBlocking, type OwnerChoice } from '../../../core/model/planBlocking';
import { cameraTitle, setupCameras } from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { Button } from '../../../ui/Button';
import { Select } from '../../../ui/fields';
import { Trans } from '../../../ui/Trans';
import { iconLabel } from './iconWords';
import { characterTitle, moveLabel } from './markLooks';
import { changeIcons, movePosition, nextPosition, setMarkOwner, type PlanView } from './planActions';
import { iconCentre, iconPatchRefused, type IconPatch } from './planItems';
import { degreesText, lengthCommit, TypedField } from './selectionFields';

// A mark in the Selection tile (6.7, decision 9): who it is (one of the scene's characters, one of the setup's cameras,
// or a plain mark), its place among its owner's positions ("2 of 3") with Earlier and Later, Next position, and its
// middle; a camera's later position its rotation too (where it points there). A link that no longer reads (a character
// trashed or taken out of the scene) says so. For a camera that moves: its move's length and its positions.

type Records = Readonly<Record<string, SbdRecord>>;

/** A choice's value in the Who list: "plain", "character:<id>", "camera:<id>". */
const choiceValue = (choice: OwnerChoice): string => (choice.kind === 'plain' ? 'plain' : `${choice.kind}:${choice.id}`);

function choiceOf(value: string): OwnerChoice | null {
  if (value === 'plain') return { kind: 'plain' };
  const [kind, id] = value.split(':');
  if ((kind === 'character' || kind === 'camera') && id) return { kind, id };
  return null;
}

export function MarkFieldsView({ id, fields, unit, records, view }: { id: string; fields: MarkFields; unit: PlanUnit; records: Records; view: PlanView }) {
  const project = useProject((s) => s.project);
  const record = records[id];
  if (!project || !record) return null;
  const owner = markOwner(records, record);
  const { stale, noCharacters } = markNotes(records, view, record);
  const of = viewBlocking(records, view.sceneId, view.setupId).numbers.get(id) ?? null;
  const characters = sceneCharacterIds(records, view.sceneId);
  const cameras = view.setupId === null ? [] : setupCameras(records, view.setupId);
  const centre = iconCentre(fields);
  const keyed = (field: string) => `${id}:${field}`;
  const write = (patch: IconPatch): boolean => {
    if (iconPatchRefused(records, [id], patch)) return false;
    void changeIcons([id], patch);
    return true;
  };
  const length = (apply: (m: number) => IconPatch) => lengthCommit(unit, write, apply, { signed: true });
  const refused = t('selection.lengthRefused');
  const value = choiceValue(owner ?? { kind: 'plain' });
  // A camera's own item is its position 1: its position 2 never goes earlier.
  const first = owner?.kind === 'camera' ? 2 : 1;
  const kind = owner === null ? t('plan.mark.plain') : owner.kind === 'character' ? t('plan.mark.characterKind') : t('plan.mark.cameraKind');
  return (
    <div className="flex flex-col gap-3" data-mark={id} data-mark-owner={owner ? `${owner.kind}:${owner.id}` : 'plain'}>
      <p className="sb-label" data-selection-kind="">
        {kind}
      </p>
      <Select
        label={t('plan.mark.who')}
        value={value}
        onChange={(event) => {
          const choice = choiceOf(event.target.value);
          if (choice) void setMarkOwner(view, [id], choice);
        }}
      >
        <option value="plain">{t('plan.mark.plain')}</option>
        {characters.length > 0 && (
          <optgroup label={t('plan.mark.characters')}>
            {characters.map((characterId) => (
              <option key={characterId} value={`character:${characterId}`}>
                {characterTitle(records, characterId)}
              </option>
            ))}
          </optgroup>
        )}
        {cameras.length > 0 && (
          <optgroup label={t('plan.mark.cameras')}>
            {cameras.map((camera) => (
              <option key={camera.record.id} value={`camera:${camera.record.id}`}>
                {cameraTitle(records, camera.record.id, iconLabel)}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      {stale !== null && (
        <p className="text-[13px] font-bold" data-mark-stale={stale}>
          {t(stale === 'character' ? 'plan.mark.staleCharacter' : 'plan.mark.staleCamera')}
        </p>
      )}
      {noCharacters && <p className="text-[12px] text-text-muted">{t('plan.mark.noCharacters')}</p>}
      {of && (
        <div className="flex flex-wrap items-center gap-2" data-mark-position={`${String(of.number)}/${String(of.count)}`}>
          <span className="sb-label">{t('plan.mark.position')}</span>
          <span className="text-[13px]">
            <Trans k="plan.mark.positionOf" parts={{ number: <span className="font-mono">{of.number}</span>, count: <span className="font-mono">{of.count}</span> }} />
          </span>
          {/* At either end, disabled, the reason in its name (6.7 review): among the positions this view shows. */}
          <Button
            variant="secondary"
            disabled={of.number <= first}
            aria-label={of.number <= first ? t('plan.mark.earlierFirst') : undefined}
            onClick={() => void movePosition(view, id, -1)}
          >
            {t('plan.mark.earlier')}
          </Button>
          <Button
            variant="secondary"
            disabled={of.number >= of.count}
            aria-label={of.number >= of.count ? t('plan.mark.laterLast') : undefined}
            onClick={() => void movePosition(view, id, 1)}
          >
            {t('plan.mark.later')}
          </Button>
        </div>
      )}
      {owner !== null && (
        <div>
          <Button variant="secondary" data-next-position="" aria-keyshortcuts="Shift+M" onClick={() => void nextPosition(view, id, project)}>
            {t('plan.mark.next')}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        {owner?.kind === 'camera' && (
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
        )}
        <TypedField key={keyed('x')} label={t('selection.x')} text={formatLength(centre.x, unit)} onCommit={length((m) => ({ centreX: m }))} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={formatLength(centre.y, unit)} onCommit={length((m) => ({ centreY: m }))} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t(owner?.kind === 'camera' ? 'plan.mark.cameraNote' : 'plan.mark.note')}</p>
    </div>
  );
}

/** A camera's move in the Selection tile (6.7): Next position, and once it has later positions, the move's length and each position. */
export function CameraMoveView({ id, unit, records, view }: { id: string; unit: PlanUnit; records: Records; view: PlanView }) {
  const project = useProject((s) => s.project);
  if (!project || view.setupId === null) return null;
  const positions = cameraPositions(records, view, id);
  const moving = positions.length > 1;
  const length = moveLength(positions);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-camera-move={moving ? String(Math.round(length * 10000) / 10000) : 'none'}>
      <p className="sb-label">{t('plan.mark.move.title')}</p>
      {moving ? (
        <>
          <p className="font-mono text-[13px]" data-camera-move-length="">
            {moveLabel(length, unit)}
          </p>
          <ol className="flex flex-col gap-0.5 text-[13px]" aria-label={t('plan.mark.positionsOf', { name: cameraTitle(records, id, iconLabel) })}>
            {positions.map((p, i) => {
              const at = iconCentre(p.fields);
              return (
                <li key={p.record.id} data-camera-position={i + 1}>
                  <Trans
                    k="plan.mark.positionAt"
                    parts={{
                      number: <span className="font-mono">{i + 1}</span>,
                      x: <span className="font-mono">{formatLength(at.x, unit)}</span>,
                      y: <span className="font-mono">{formatLength(at.y, unit)}</span>,
                    }}
                  />
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="text-[12px] text-text-muted">{t('plan.mark.move.none')}</p>
      )}
      <div>
        <Button variant="secondary" data-next-position="" aria-keyshortcuts="Shift+M" onClick={() => void nextPosition(view, id, project)}>
          {t('plan.mark.next')}
        </Button>
      </div>
    </div>
  );
}
