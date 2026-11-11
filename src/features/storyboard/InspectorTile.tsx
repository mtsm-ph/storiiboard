import { showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { mediaFields } from '../../core/media/store';
import { customFieldNames, customFieldsOf, hiddenFieldNames } from '../../core/model/customFields';
import { aspectRatioValue, projectStoryboard, sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import { approvalNow, signatureOf, useMyPart } from '../../app/settings/projectRole';
import { approverRoles } from '../../core/model/departmentStatus';
import { DEPARTMENTS } from '../../core/model/department';
import { approvalBasis, sceneApprovals } from '../../core/model/sceneApprovals';
import { editDepartmentStatus } from './departmentEdit';
import { approveSceneDepartment } from './sceneApprovalEdit';
import { SceneApprovalTable } from './SceneApprovalTable';
import { FrameGear } from '../gear/FrameGear';
import { gearListChange } from '../gear/gearEdits';
import { RestOfCrew } from '../department/RestOfCrew';
import { usePerspective } from '../department/perspective';
import { openDepartment } from '../department/openDepartment';
import { addPictures } from './addPictures';
import { paletteOf } from '../../core/model/palette';
import { copyHex, editPalette, generatePalette } from './palette/actions';
import { PaletteEditor } from './palette/PaletteEditor';
import { boardsLinkedTo } from '../moodboards/boards';
import { LinkedBoards } from '../moodboards/LinkedBoards';
import { addColour, startEyedropper, stopEyedropper, useEyedropperScene } from './palette/Eyedropper';
import { framesWithPictures } from './palette/read';
import { locations, setCustomField, setFrameLocation, setSceneNumber } from './board';
import { pictureView, removePicture, setCrop } from './framePictures';
import { InspectorView, type FieldChange, type InspectorCopy, type InspectorPicture, type InspectorVideo } from './InspectorView';
import { frameTimecode } from '../../core/media/timecode';
import { displayAspect, readClip, readFromVideo, videoFields } from '../../core/media/video';
import { videoDriver } from '../../app/video';
import { addVideos } from '../video/addVideos';
import { fpsLabel, relinkVideo } from '../video/relink';
import { useVideoMissing } from '../video/videoStatus';
import { cancelCopy, makeCopy, useCopy, useCopyUrl, type CopyState } from '../video/playbackCopies';
import { loadLut, setLut, useProjectLuts } from '../video/lutEdits';
import { cancelSaveClip, saveClip, useClipSaving } from '../video/saveClip';
import { ProjectPictures } from './ProjectPictures';
import { openSketch } from './sketch/sketchStore';
import { strokesOf } from './sketch/strokes';
import { useSelection } from './selection';
import { t, tn } from '../../core/i18n';

/** Escape from the inspector: focus goes back to the frame (or the scene) it was showing. */
function focusBoard(shotId: string | null, sceneId: string | null) {
  const target = shotId
    ? document.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(shotId)}"]`)
    : sceneId
      ? document.querySelector<HTMLElement>(`[data-scene-group="${CSS.escape(sceneId)}"] [data-board-item]`)
      : null;
  target?.focus();
}

/** The queue's state of a copy, as the inspector shows it; 'unknown' never comes here. */
function inspectorCopy(copy: Exclude<CopyState, { kind: 'unknown' }>): InspectorCopy {
  switch (copy.kind) {
    case 'none':
    case 'queued':
      return { state: copy.kind };
    case 'making':
      return { state: 'making', done: copy.done };
    case 'made':
      return { state: 'made', silent: copy.silent, ...(copy.quiet ? { quiet: true } : {}) };
    case 'failed':
      return { state: 'failed', message: copy.message };
  }
}

export function InspectorTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const applyWith = useProject((s) => s.applyWith);
  const sceneId = useSelection((s) => s.sceneId);
  const shotId = useSelection((s) => s.shotId);
  // What this person can approve here: the person they picked in Cast and crew (3.5c), else their role on this
  // project (polish 6), else their usual one.
  const { role, person: me } = useMyPart(project?.projectId);
  // Your departments first (3.6c), unless you see everything.
  const focus = usePerspective(project?.projectId);
  // The name you sign with once you've picked yourself (3.5c): that person's, '' when they're unnamed; null otherwise.
  const myName = signatureOf(me);
  const seen = useProject((s) => (shotId ? s.seen[shotId] : undefined));
  const picking = useEyedropperScene();
  // Before the early return, as every hook: whether the selected frame's video is missing here.
  const clipVideoId = shotId ? (readClip(records[shotId]?.props ?? {})?.videoId ?? null) : null;
  const videoMissing = useVideoMissing(clipVideoId);
  const copy = useCopy(clipVideoId);
  const copyUrl = useCopyUrl(clipVideoId, copy, videoMissing);
  // The frame whose clip is being saved (2.8b), so a second press waits for it.
  const savingFor = useClipSaving();
  const projectLuts = useProjectLuts();

  if (!project) return <p className="sb-label p-3 text-text-muted">{t('inspectorTile.noProjectOpen')}</p>;
  const sceneRecord = sceneId ? records[sceneId] : undefined;
  const scene = sceneRecord?.type === 'scene' && sceneRecord.trashedAt === null ? sceneRecord : undefined;
  const shotRecord = shotId ? records[shotId] : undefined;
  const shot =
    shotRecord?.type === 'shot' && shotRecord.trashedAt === null && shotRecord.parentId === scene?.id ? shotRecord : undefined;
  // Trashed scenes count, as + Scene counts them, so a restored scene never shares its number with one renumbered since.
  const others = Object.values(records).filter((r) => r.type === 'scene' && r.id !== scene?.id && r.parentId === project.projectId);
  const otherSceneNumbers = others.filter((r) => r.trashedAt === null).map((r) => sceneFields(r.props).number);
  const trashedSceneNumbers = others.filter((r) => r.trashedAt !== null).map((r) => sceneFields(r.props).number);

  const update = (id: string, { set, unset }: FieldChange) => {
    void apply([{ kind: 'update', id, ...(set ? { set } : {}), ...(unset ? { unset } : {}) }]);
  };

  const fields = shot ? shotFields(shot.props) : null;
  const view = fields ? pictureView(records, fields) : null;
  const media = view && fields?.mediaId ? mediaFields(records[fields.mediaId]?.props ?? {}) : null;
  // A picture deleted for good and named again by a restore (sha256 '') shows as missing here too, as on the board,
  // with Remove to clear it.
  // A still from the frame's video names no file of its own: the Video section names the video (2.2b).
  const fromVideo = fields?.mediaId ? readFromVideo(records[fields.mediaId]?.props ?? {}) : null;
  const fromItsVideo = fromVideo !== null;
  // Said by where it came from instead (2.7): the frame's timecode, as on the slate, and the LUT it was graded with.
  const stillFrom = !fromVideo
    ? ''
    : fromVideo.timecode === ''
      ? t('inspector.stillFromVideo')
      : fromVideo.lutName
        ? t('inspector.stillAtWithLut', { timecode: fromVideo.timecode, lut: fromVideo.lutName })
        : t('inspector.stillAt', { timecode: fromVideo.timecode });
  const picture: InspectorPicture | null = !view
    ? null
    : media
      ? fromItsVideo
        ? { view, sourceName: stillFrom, sourcePath: '' }
        : { view, sourceName: media.sourceName, sourcePath: media.sourcePath }
      : view.sha256 === ''
        ? { view, sourceName: '', sourcePath: '' }
        : null;

  // The video the frame plays (2.2b): its file, its rate and size, and the clip's timecode in to out. A clip whose
  // video is gone (Empty Trash, a History restore) still shows, missing, with Unlink.
  const clip = shot ? readClip(shot.props) : null;
  const videoRecord = clip ? records[clip.videoId] : undefined;
  const linked = videoRecord && videoRecord.trashedAt === null ? videoFields(videoRecord.props) : null;
  const video: InspectorVideo | null = !clip
    ? null
    : !linked
      ? { name: '', details: '', range: '', frames: '', path: '', missing: true, gone: true }
      : {
          name: linked.sourceName,
          details: t('inspector.videoDetails', { fps: fpsLabel(linked.fps), width: linked.width, height: linked.height, codec: linked.codec.toUpperCase() }),
          range: t('inspector.videoRange', {
            start: frameTimecode(clip.inFrame, linked.fps, linked.startTimecode),
            end: frameTimecode(clip.outFrame, linked.fps, linked.startTimecode),
          }),
          frames: tn('inspector.videoFrames', clip.outFrame - clip.inFrame + 1),
          path: linked.sourcePath,
          missing: videoMissing,
          gone: false,
          ...(copy.kind === 'unknown' ? {} : { copy: inspectorCopy(copy) }),
          ...(copyUrl
            ? {
                preview: {
                  videoId: clip.videoId,
                  frameKey: shot?.id ?? '',
                  url: copyUrl,
                  inFrame: clip.inFrame,
                  outFrame: clip.outFrame,
                  fps: linked.fps,
                  crop: clip.crop,
                  imageAspect: displayAspect(linked),
                  frameAspect: aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio),
                },
              }
            : {}),
          lut: { id: linked.lutId, choices: projectLuts.rows.map((lut) => ({ id: lut.id, name: lut.name })), listed: projectLuts.listed && (linked.lutId === null || !projectLuts.pending.includes(linked.lutId)) },
        };

  const locationId = scene ? sceneFields(scene.props).locationId : null;
  const location = locationId ? records[locationId] : undefined;
  // A live one without a name reads as unnamed, not as none.
  const locationName =
    location?.type === 'location' && location.trashedAt === null
      ? typeof location.props.name === 'string' && location.props.name.trim() !== ''
        ? location.props.name
        : t('locations.unnamed')
      : null;
  // A frame shot somewhere other than its scene's location (3.3): its own, among the project's live ones. The scene's
  // own location isn't offered again (picking it would pin the frame there for good, with nothing to show it). One the
  // frame has that the list leaves out (unnamed, or in the Trash) is shown as it is, so it can be taken off.
  const ownId = shot && typeof shot.props.location_id === 'string' ? shot.props.location_id : '';
  const own = ownId ? records[ownId] : undefined;
  const ownLocation = own?.type === 'location' ? ownId : '';
  const live = locations(records, project.projectId).filter((choice) => choice.id !== locationId || choice.id === ownLocation);
  const ownMissing = own?.type === 'location' && !live.some((choice) => choice.id === ownLocation);
  const ownName = own && typeof own.props.name === 'string' && own.props.name.trim() !== '' ? own.props.name : t('locations.unnamed');
  const frameLocation = shot
    ? {
        value: ownLocation,
        sceneName: locationName,
        choices: ownMissing ? [...live, { id: ownLocation, name: own.trashedAt !== null ? t('inspectorView.inTheTrash', { name: ownName }) : ownName }] : live,
        onChange: (id: string | null) => {
          void projectStore.getState().applyWith((now) => ({ changes: setFrameLocation(now, shot.id, id) }));
        },
      }
    : undefined;

  return (
    <ProjectPictures>
      <InspectorView
        scene={scene ? { id: scene.id, fields: sceneFields(scene.props) } : null}
        shot={shot ? { id: shot.id, fields: shotFields(shot.props) } : null}
        otherSceneNumbers={otherSceneNumbers}
        trashedSceneNumbers={trashedSceneNumbers}
        onShotChange={(change) => {
          if (shot) update(shot.id, change);
        }}
        onSceneChange={(change) => {
          if (scene) update(scene.id, change);
        }}
        onSceneNumberChange={(number) => {
          // Renumbers its unlocked shots in the same edit.
          if (scene) void applyWith((now, slate) => ({ changes: setSceneNumber(now, project.projectId, scene.id, number, slate) }));
        }}
        onBack={() => {
          focusBoard(shot?.id ?? null, scene?.id ?? null);
        }}
        onDepartmentStatus={(edit) => {
          if (shot) editDepartmentStatus(shot.id, edit);
        }}
        onOpenDepartment={openDepartment}
        palette={
          scene ? (
            <PaletteEditor
              key={scene.id}
              scene={sceneLabel(sceneFields(scene.props).number)}
              palette={paletteOf(scene.props)}
              canGenerate={framesWithPictures(records, scene.id).length > 0}
              onGenerate={() => generatePalette(scene.id)}
              onEdit={(edit) => editPalette(scene.id, edit)}
              onCopy={copyHex}
              picking={picking === scene.id}
              onPick={() => {
                if (picking === scene.id) stopEyedropper();
                else startEyedropper(scene.id);
              }}
              onAddHex={(hex) => addColour(scene.id, hex)}
            />
          ) : undefined
        }
        boards={
          scene && boardsLinkedTo(records, project.projectId, 'scene', scene.id).length > 0 ? <LinkedBoards kind="scene" id={scene.id} label={false} /> : undefined
        }
        focus={focus}
        gear={
          shot ? (
            <FrameGear
              records={records}
              projectId={project.projectId}
              shotId={shot.id}
              onToggle={(gearIds, on) => {
                void projectStore.getState().applyWith((now) => ({ changes: gearListChange(now, shot.id, gearIds, on) }));
              }}
              onAddToDay={(dayId, gearIds) => {
                void projectStore.getState().applyWith((now) => ({ changes: gearListChange(now, dayId, gearIds, true) }));
              }}
            />
          ) : undefined
        }
        approvals={
          scene ? (
            // Keyed by scene: the Tab stop starts on the first row for each. In the focus view, your departments' rows,
            // then the rest under Rest of crew.
            <RestOfCrew
              fold="scene"
              departments={DEPARTMENTS}
              focus={focus}
              render={(rows, part, last) => (
                <SceneApprovalTable
                  key={`${scene.id}-${part}-${rows.join(',')}`}
                  scene={sceneLabel(sceneFields(scene.props).number)}
                  approvals={sceneApprovals(scene.props)}
                  basisOf={(department) => approvalBasis(records, scene.id, department)}
                  departments={rows}
                  myRoles={approverRoles(role)}
                  onApprove={(department) => {
                    approveSceneDepartment(scene.id, department, () => approvalNow(role, new Date(), myName));
                  }}
                  {...(part === 'all'
                    ? {}
                    : {
                        label: t(part === 'mine' ? 'restOfCrew.yoursForScene' : 'restOfCrew.restForScene', {
                          scene: sceneLabel(sceneFields(scene.props).number),
                        }),
                      })}
                  note={last}
                />
              )}
            />
          ) : undefined
        }
        {...(seen ? { seen } : {})}
        picture={picture}
        locationName={locationName}
        {...(frameLocation ? { frameLocation } : {})}
        strokeCount={shot ? strokesOf(records, shot.id).length : 0}
        onSketch={() => {
          if (shot) openSketch(shot.id);
        }}
        frameAspect={aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio)}
        onChoosePicture={() => {
          if (!shot) return;
          choosePictures(false)
            .then((files) => addPictures(files, { kind: 'frame', shotId: shot.id }))
            .catch(showNotice);
        }}
        onRemovePicture={() => {
          if (shot) void apply(removePicture(records, shot.id));
        }}
        video={video}
        onLinkVideo={() => {
          if (!shot) return;
          videoDriver
            .choose(false)
            .then((files) => addVideos(files, { kind: 'frame', shotId: shot.id }))
            .catch(showNotice);
        }}
        onRelinkVideo={() => {
          if (clip) void relinkVideo(clip.videoId);
        }}
        onMakeCopy={() => {
          if (clip) makeCopy(clip.videoId);
        }}
        onCancelCopy={() => {
          if (clip) cancelCopy(clip.videoId);
        }}
        savingClip={savingFor !== null && savingFor === shot?.id}
        onSaveClip={() => {
          if (shot) void saveClip(shot.id);
        }}
        onCancelSaveClip={() => {
          void cancelSaveClip();
        }}
        onLoadLut={() => {
          if (clip) void loadLut(clip.videoId);
        }}
        onSetLut={(lutId) => {
          if (clip) void setLut(clip.videoId, lutId);
        }}
        onUnlinkVideo={() => {
          // The picture stays; the frame stops playing the video. The video's record stays for other frames.
          if (shot) void apply([{ kind: 'update', id: shot.id, unset: ['clip'] }]);
        }}
        onCropChange={(crop) => {
          if (shot) void apply([setCrop(shot.id, crop)]);
        }}
        customFields={shot ? customFieldsOf(shot.props) : {}}
        customNames={customFieldNames(records)}
        customHidden={shot ? hiddenFieldNames(shot.props) : []}
        onCustomChange={async (name, value) => {
          if (!shot) return;
          // Worked out when it lands, so two fields added quickly both stay.
          await projectStore.getState().applyWith((now) => ({ changes: setCustomField(now, shot.id, name, value) }));
        }}
      />
    </ProjectPictures>
  );
}
