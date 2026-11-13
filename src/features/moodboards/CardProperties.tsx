import { showNotice } from '../../app/notice';
import { revealOriginal } from '../../app/opener';
import { t } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { relinkVideo } from '../video/relink';
import { changeLink } from './boardActions';
import type { CardInfo } from './cards';
import { cardUrl } from './links';
import { platformOf, showOriginalKey, useOriginalShown } from './showOriginal';
import type { ItemFields } from './items';

// What the properties strip shows for one selected picture, video card or link (5.1b): a picture's original and, when
// the file is there, Show in Finder or Explorer (5.9), a video's file (with Relink when it's missing), a link's address and title, both editable.

interface Props {
  id: string;
  fields: ItemFields;
  card: CardInfo | null;
  /** The picture's original, from its media record. */
  original: { name: string; path: string; sha256: string; recordId: string } | null;
}

export function CardProperties({ id, fields, card, original }: Props) {
  if (fields.kind === 'picture') return <PictureFields original={original} />;
  if (fields.kind === 'video') {
    return (
      <>
        <div className="flex min-w-40 max-w-80 flex-col gap-[5px]">
          <span className="sb-label">{t('moodboard.videoFile')}</span>
          <span data-user-text="" className="flex h-8 items-center truncate font-mono text-[13px]" title={card?.name}>
            {card?.name ?? ''}
          </span>
        </div>
        {card?.missing && card.videoId !== null && (
          <>
            <span data-video-missing="" className="inline-block self-end bg-warning px-[7px] py-1 text-[12px] text-paper-fixed">
              {t('moodboard.videoMissingLine')}
            </span>
            <Button
              data-relink-video=""
              onClick={() => {
                if (card.videoId !== null) void relinkVideo(card.videoId);
              }}
            >
              {t('inspector.relink')}
            </Button>
          </>
        )}
      </>
    );
  }
  if (fields.kind === 'link') return <LinkFields key={`${id}|${fields.url}|${fields.title}`} id={id} fields={fields} />;
  return null;
}

/** A link's address and title. Each is saved when focus leaves it; an address that isn't http or https isn't kept. */
function LinkFields({ id, fields }: { id: string; fields: ItemFields }) {
  return (
    <>
      <div className="w-72">
        <TextField
          label={t('moodboard.link.address')}
          mono
          data-link-address=""
          defaultValue={fields.url}
          autoComplete="off"
          onBlur={(event) => {
            const url = cardUrl(event.currentTarget.value);
            if (url === null) {
              // Said as a notice (announced, and it fits the band); the field goes back to the address it had.
              showNotice(t('moodboard.link.invalid'));
              event.currentTarget.value = fields.url;
            } else void changeLink(id, { url });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      <div className="w-56">
        <TextField
          label={t('moodboard.link.title')}
          data-link-title=""
          defaultValue={fields.title}
          autoComplete="off"
          onBlur={(event) => {
            void changeLink(id, { title: event.currentTarget.value.trim() });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
    </>
  );
}

/** A picture's original, and the action that shows it in its folder: there only while the file is. */
function PictureFields({ original }: { original: Props['original'] }) {
  const recorded = original !== null && original.path !== '';
  // Rust looks the picture's record up itself: a pasted picture has no original recorded, and is told no.
  const [exists, forget] = useOriginalShown(original?.recordId ?? null, original?.sha256 ?? null);
  return (
    <>
      <div className="flex min-w-40 max-w-80 flex-col gap-[5px]">
        <span className="sb-label">{t('moodboard.original')}</span>
        <span data-picture-original="" data-user-text="" className="flex h-8 items-center truncate font-mono text-[13px]" title={original?.path}>
          {recorded ? original.name || original.path : t('moodboard.pastedPicture')}
        </span>
      </div>
      {exists && original && (
        <Button
          data-show-original=""
          onClick={(event) => {
            // The button goes with a failed reveal: focus moves to the board first, not to the top of the page.
            const button = event.currentTarget;
            revealOriginal(original.recordId, original.sha256).catch((error: unknown) => {
              button.closest('[role="region"]')?.querySelector<HTMLElement>('[data-moodboard-canvas] [role="application"]')?.focus();
              showNotice(error);
              forget();
            });
          }}
        >
          {t(showOriginalKey(platformOf(navigator.userAgent)))}
        </Button>
      )}
    </>
  );
}
