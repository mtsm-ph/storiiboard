import { useId, useState } from 'react';
import { showInfo, showNotice } from '../../app/notice';
import { choosePdfs } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import { ATTACHMENT_KIND_LABEL, linkUrl, projectAttachments, sizeLabel, type Attachment } from '../../core/model/attachment';
import { locationFields } from '../../core/model/location';
import { personFields } from '../../core/model/person';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import { Button } from '../../ui/Button';
import { Select, TextField } from '../../ui/fields';
import { addPdfs, newLink, renameAttachment, savePdfCopy, trashAttachment } from './attachmentEdits';

// The Assets tile (3.11), in the Assets workspace: the project's PDFs and links, on the project itself or on a scene,
// a frame, a location or a person, grouped by what they're on. A PDF is kept inside the project (at most 50 MB) and
// opened outside Storiiboard by saving a copy; a link is copied to the clipboard (opening either from the app waits
// for the opener plugin, a dependency Kevin decides on). Each change is one edit, so one ⌘Z; Delete sends one to the
// Trash.

type Records = Readonly<Record<string, SbdRecord>>;

/** What an attachment is on, as the list names it: "Project", "SC 04", "Frame 4A", "Location · Diner", "Sam Ortiz". */
function onLabel(record: SbdRecord): string {
  switch (record.type) {
    case 'project':
      return t('assets.onProject');
    case 'scene':
      return sceneLabel(sceneFields(record.props).number);
    case 'shot':
      return t('assets.onFrame', { frame: shotFields(record.props).number || '—' });
    case 'location':
      return t('assets.onLocation', { name: locationFields(record.props).name || t('locations.unnamed') });
    case 'person':
      return t('assets.onPerson', { name: personFields(record.props).name || t('people.unnamed') });
    default:
      return '';
  }
}

/** Everything an attachment can go on, in the order the picker lists it: the project, scenes and their frames, places, people. */
function targets(records: Records, projectId: string): { id: string; label: string }[] {
  const live = Object.values(records).filter((r) => r.trashedAt === null);
  const byKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);
  const project = records[projectId];
  const scenes = live.filter((r) => r.type === 'scene' && r.parentId === projectId).sort(byKey);
  const out: { id: string; label: string }[] = project ? [{ id: projectId, label: onLabel(project) }] : [];
  for (const scene of scenes) {
    out.push({ id: scene.id, label: onLabel(scene) });
    // Each frame under its scene, the scene named with it: a picker draws no indent.
    for (const shot of live.filter((r) => r.type === 'shot' && r.parentId === scene.id).sort(byKey)) {
      out.push({ id: shot.id, label: t('assets.frameInScene', { scene: onLabel(scene), frame: onLabel(shot) }) });
    }
  }
  for (const type of ['location', 'person'] as const) {
    for (const r of live.filter((x) => x.type === type && x.parentId === projectId).sort((a, b) => onLabel(a).localeCompare(onLabel(b)))) {
      out.push({ id: r.id, label: onLabel(r) });
    }
  }
  return out;
}

export function AssetsTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [on, setOn] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const listId = useId();
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('assets.noProject')}</p>;
  const projectId = project.projectId;
  const choices = targets(records, projectId);
  // The picked one while it's there, else the project.
  const target = choices.some((c) => c.id === on) ? (on ?? projectId) : projectId;
  const all = projectAttachments(records, projectId);
  // Grouped by what they're on, in the picker's order.
  const order = new Map(choices.map((c, i) => [c.id, i]));
  const groups = [...new Set(all.map((a) => a.on.id))]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((id) => ({ on: all.find((a) => a.on.id === id)?.on, items: all.filter((a) => a.on.id === id) }));

  const addLink = () => {
    const address = linkUrl(url);
    if (!address) {
      showInfo(t('assets.badLink'));
      return;
    }
    void projectStore
      .getState()
      .applyWith((now) => ({ changes: newLink(now, target, address, title) }))
      .then((done) => {
        if (!done) return;
        setUrl('');
        setTitle('');
        // Focus back in the address, ready for the next, rather than on Add link, which an empty address turns off.
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-link-url]')?.focus());
      });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 border-b border-border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Select
              label={t('assets.attachTo')}
              data-attach-to=""
              value={target}
              onChange={(event) => {
                setOn(event.currentTarget.value);
              }}
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            data-add-pdf=""
            // Not disabled while the dialog is open, which would drop focus: a second press is ignored instead.
            aria-disabled={adding || undefined}
            onClick={() => {
              if (adding) return;
              setAdding(true);
              void choosePdfs()
                .then((files) => addPdfs(files, target))
                .catch(showNotice)
                .finally(() => {
                  setAdding(false);
                });
            }}
          >
            {t('assets.addPdf')}
          </Button>
        </div>
        <form
          // The address is checked here (linkUrl), which takes a bare one too: the browser's own check wants https://.
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            addLink();
          }}
        >
          <div className="min-w-48 flex-1">
            <TextField
              label={t('assets.linkUrl')}
              type="url"
              data-link-url=""
              value={url}
              autoComplete="off"
              placeholder={t('assets.linkPlaceholder')}
              onChange={(event) => {
                setUrl(event.currentTarget.value);
              }}
            />
          </div>
          <div className="min-w-40 flex-1">
            <TextField
              label={t('assets.linkTitle')}
              value={title}
              autoComplete="off"
              onChange={(event) => {
                setTitle(event.currentTarget.value);
              }}
            />
          </div>
          <Button type="submit" disabled={url.trim() === ''}>
            {t('assets.addLink')}
          </Button>
        </form>
      </div>
      <p className="sb-label px-3 pt-3 font-mono">{tn('assets.count', all.length)}</p>
      {all.length === 0 ? (
        <p className="p-3 text-[13px] text-text-muted">{t('assets.none')}</p>
      ) : (
        <div id={listId} className="flex flex-col gap-3 p-3">
          {groups.map(({ on: holder, items }) =>
            holder ? (
              <section key={holder.id} aria-label={onLabel(holder)} className="flex flex-col">
                <h2 className="sb-label border-b-[1.5px] border-text pb-1">{onLabel(holder)}</h2>
                <ul>
                  {items.map((item) => (
                    <AttachmentRow key={item.record.id} item={item} />
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({ item }: { item: Attachment }) {
  const { record, fields } = item;
  const name = fields.name || (fields.kind === 'link' ? fields.url : t('assets.unnamedPdf'));
  // Each control named by what it shows, then which item (WCAG 2.5.3).
  const named = (shown: string) => t('assets.forItem', { shown, name });
  const fieldLabel = fields.kind === 'pdf' ? t('assets.fileName') : t('assets.linkTitle');
  const edit = (build: (now: Records) => ReturnType<typeof renameAttachment>) => projectStore.getState().applyWith((now) => ({ changes: build(now) }));
  return (
    <li data-attachment={record.id} className="flex flex-wrap items-end gap-2 border-b border-border py-2 text-[13px]">
      <span className="sb-label w-10 shrink-0 pb-2">{ATTACHMENT_KIND_LABEL[fields.kind]}</span>
      <div className="min-w-40 flex-1">
        <TextField
          key={`name:${fields.name}`}
          label={fieldLabel}
          aria-label={named(fieldLabel)}
          defaultValue={fields.name}
          autoComplete="off"
          onBlur={(event) => {
            // Read now: the edit is worked out later, when the event's target is long gone.
            const next = event.currentTarget.value;
            if (next !== fields.name) void edit((now) => renameAttachment(now, record.id, next));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      {fields.kind === 'pdf' ? (
        <span className="pb-2 font-mono text-[12px]">{sizeLabel(fields.byteSize)}</span>
      ) : (
        <span data-user-text="" className="max-w-60 truncate pb-2 font-mono text-[12px]" title={fields.url}>
          {fields.url}
        </span>
      )}
      {fields.kind === 'pdf' ? (
        <Button
          aria-label={named(t('assets.saveCopy'))}
          onClick={() => {
            void savePdfCopy(fields.file, fields.name || 'attachment.pdf');
          }}
        >
          {t('assets.saveCopy')}
        </Button>
      ) : (
        <Button
          aria-label={named(t('assets.copyLink'))}
          onClick={() => {
            const clipboard = (navigator as Partial<Navigator>).clipboard;
            if (!clipboard) {
              showInfo(t('location.linkNotCopied', { link: fields.url }));
              return;
            }
            void clipboard.writeText(fields.url).then(
              () => {
                showInfo(t('assets.linkCopied'));
              },
              () => {
                showInfo(t('location.linkNotCopied', { link: fields.url }));
              },
            );
          }}
        >
          {t('assets.copyLink')}
        </Button>
      )}
      <Button
        variant="warning"
        aria-label={named(t('assets.delete'))}
        onClick={() => {
          void edit((now) => trashAttachment(now, record.id)).then((done) => {
            if (!done) return;
            showInfo(t('assets.trashed', { name }), { step: true });
            // Its row is gone: focus to Attach to, at the top of the tile, rather than to the page.
            requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-attach-to]')?.focus());
          });
        }}
      >
        {t('assets.delete')}
      </Button>
    </li>
  );
}
