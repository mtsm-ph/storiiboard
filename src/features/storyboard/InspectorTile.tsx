import { showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { mediaFields } from '../../core/media/store';
import { customFieldNames, customFieldsOf, hiddenFieldNames } from '../../core/model/customFields';
import { aspectRatioValue, projectStoryboard, sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import { approvalNow, useProjectRole } from '../../app/settings/projectRole';
import { approverRoles, departmentStatusChange, departmentStatuses } from '../../core/model/departmentStatus';
import { addPictures } from './addPictures';
import { paletteOf } from '../../core/model/palette';
import { copyHex, editPalette, generatePalette } from './palette/actions';
import { PaletteEditor } from './palette/PaletteEditor';
import { addColour, startEyedropper, stopEyedropper, useEyedropperScene } from './palette/Eyedropper';
import { framesWithPictures } from './palette/read';
import { setCustomField, setSceneNumber } from './board';
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
  // What this person can approve here (polish 6): their role on this project, else their usual one.
  const role = useProjectRole(project?.projectId);
  const seen = useProject((s) => (shotId ? s.seen[shotId] : undefined));
  const picking = useEyedropperScene();
  // Before the early return, as every hook: whether the selected frame's video is missing here.
  const clipVideoId = shotId ? (readClip(records[shotId]?.props ?? {})?.videoId ?? null) : null;
  const videoMissing = useVideoMissing(clipVideoId);
  const copy = useCopy(clipVideoId);
  const copyUrl = useCopyUrl(clipVideoId, copy, videoMissing);
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
  const locationName =
    location && location.trashedAt === null && typeof location.props.name === 'string' ? location.props.name : null;

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
          if (!shot) return;
          // From the frame as it is when this lands, as custom fields are: two quick ticks both stay.
          void projectStore.getState().applyWith((now) => {
            const current = now[shot.id];
            const next = current ? edit(departmentStatuses(current.props)) : null;
            return { changes: current && next ? [{ kind: 'update', id: shot.id, ...departmentStatusChange(next) }] : [] };
          });
        }}
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
        approval={() => approvalNow(role)}
        myRoles={approverRoles(role)}
        {...(seen ? { seen } : {})}
        picture={picture}
        locationName={locationName}
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
