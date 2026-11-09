import { useEffect, useState } from 'react';
import { localDateTime } from '../../app/format';
import { showNotice } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useLocale } from '../../ui/useLocale';
import { LineText } from '../history/HistoryTile';
import { loadSteps, PAGE, type Steps } from '../history/steps';
import { who } from '../history/summary';
import { selectionStore, useSelection } from '../storyboard/selection';
import { markAllRead, markStepRead, stepUnread, unreadCount, useNotifications } from './notificationsStore';

// The Notifications tile (3.10, CLAUDE.md: Notifications): History's steps, newest first, what changed, who and when,
// with read and unread for whoever is reading (This is me, else this computer's `local`). Filters All, Unread and This
// scene; Mark all read. Opening a step marks it read and picks what it changed: a frame, else a scene, so the
// Inspector and the board show it. Steps you made count as read. Suggestions and comments join with Phases 7 and 9.

type Records = Readonly<Record<string, SbdRecord>>;
type Filter = 'all' | 'unread' | 'scene';

/** Whether a record is the scene, or in it (a frame, a note, a frame's picture or stroke). */
function inScene(records: Records, id: string, sceneId: string): boolean {
  let at: SbdRecord | undefined = records[id];
  for (let depth = 0; at && depth < 3; depth += 1) {
    if (at.id === sceneId) return true;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return false;
}

/** What a step changed to pick: its first live frame, else its first live scene. */
function pickOf(records: Records, ids: readonly string[]): { shot: string | null; scene: string } | null {
  const live = (id: string, type: SbdRecord['type']) => {
    const record = records[id];
    return record?.type === type && record.trashedAt === null ? record : undefined;
  };
  for (const id of ids) {
    const shot = live(id, 'shot');
    if (shot?.parentId && live(shot.parentId, 'scene')) return { shot: shot.id, scene: shot.parentId };
  }
  for (const id of ids) if (live(id, 'scene')) return { shot: null, scene: id };
  return null;
}

export function NotificationsTile() {
  const project = useProject((s) => s.project);
  // Keyed by the open file, not the project's id (a copy, a backup or an import keeps that): another file's steps
  // never show while this one's are read.
  return project ? <Feed key={project.file.path} /> : <p className="sb-label p-3 text-text-muted">{t('notifications.noProject')}</p>;
}

function Feed() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  const locale = useLocale();
  const sceneId = useSelection((s) => s.sceneId);
  const state = useNotifications((s) => s);
  const unread = unreadCount(state);
  const [filter, setFilter] = useState<Filter>('all');
  const [steps, setSteps] = useState<Steps['steps'] | null>(null);
  const [more, setMore] = useState(false);
  // History's first page, and more on asking: the count covers every step, so the older ones are a click away.
  const [count, setCount] = useState(PAGE);

  // Read again after every edit, undo and restore, as History is.
  useEffect(() => {
    if (!project) return;
    let live = true;
    loadSteps(project.file, count)
      .then((next) => {
        if (!live) return;
        setSteps(next.steps);
        setMore(next.more);
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [project, records, canUndo, locale, count]);

  if (!project) return null;
  const shown = (steps ?? []).filter(({ group, recordIds }) =>
    filter === 'unread' ? stepUnread(state, group) : filter === 'scene' ? sceneId !== null && recordIds.some((id) => inScene(records, id, sceneId)) : true,
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <SegmentedControl<Filter>
          label={t('notifications.show')}
          options={[
            { value: 'all', label: t('notifications.all') },
            { value: 'unread', label: t('notifications.unread') },
            { value: 'scene', label: t('notifications.thisScene') },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <p className="sb-label pb-1 font-mono">{tn('notifications.unreadCount', unread)}</p>
        <Button
          className="ml-auto"
          disabled={unread === 0}
          onClick={() => {
            void markAllRead();
          }}
        >
          {t('notifications.markAllRead')}
        </Button>
      </div>
      {steps === null ? (
        <p className="p-3 text-[13px] text-text-muted">{t('historyTile.readingHistory')}</p>
      ) : shown.length === 0 ? (
        <p className="p-3 text-[13px] text-text-muted">
          {filter === 'unread' ? t('notifications.noneUnread') : filter === 'scene' ? t('notifications.noneInScene') : t('notifications.none')}
        </p>
      ) : (
        <ol aria-label={t('notifications.list')} className="flex flex-col">
          {shown.map(({ group, line, recordIds }) => {
            const isUnread = stepUnread(state, group);
            return (
              <li key={group.id}>
                <button
                  type="button"
                  data-notification={group.id}
                  onClick={() => {
                    void markStepRead(group);
                    const pick = pickOf(records, recordIds);
                    if (pick?.shot) selectionStore.getState().selectShot(pick.shot, pick.scene);
                    else if (pick) selectionStore.getState().selectScene(pick.scene);
                  }}
                  className={cx('flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left hover:bg-surface-raised focus-visible:-outline-offset-2')}
                >
                  {/* Unread: a dot in ink and the line in bold, and said first; read rows keep the dot's room. */}
                  <span aria-hidden="true" className="w-2 shrink-0 pt-1 text-[10px]">
                    {isUnread ? '●' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    {isUnread && <span className="sr-only">{t('notifications.unreadMark')} </span>}
                    <span className={cx('block text-[13px]', isUnread && 'font-bold')}>
                      <LineText line={line} />
                    </span>
                    <span className="block font-mono text-[11px]">
                      {who(group.author) !== '' && (
                        <>
                          <bdi className="font-sans wrap-anywhere">{who(group.author)}</bdi>
                          {' · '}
                        </>
                      )}
                      {localDateTime(new Date(group.timestamp))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {more && (
        <div className="p-3">
          <Button
            onClick={() => {
              setCount((c) => c + PAGE);
            }}
          >
            {t('historyTile.showOlderSteps')}
          </Button>
        </div>
      )}
    </div>
  );
}
