import { useState } from 'react';
import { t } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { InAppWindow } from '../../ui/InAppWindow';
import { placeLink } from './boardActions';
import { cardUrl } from './links';
import type { LinkAsk } from './moodboardStore';

// The Link tool's question (5.1b): the card's address, and a title if the person wants one. The address is checked here
// (http or https only; a bare "vimeo.com/1" gets https://). Nothing is fetched to fill the card.

export function LinkDialog({ ask, onClose }: { ask: LinkAsk; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [bad, setBad] = useState(false);
  const submit = () => {
    if (cardUrl(url) === null) {
      setBad(true);
      return;
    }
    onClose();
    void placeLink(ask.boardId, ask.geometry, url, title);
  };
  return (
    <InAppWindow title={t('moodboard.link.dialogTitle')} onClose={onClose} width={440}>
      <form
        noValidate
        data-link-dialog=""
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t('moodboard.link.address')}
          mono
          data-link-url=""
          value={url}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the window exists to ask for this
          autoFocus
          aria-invalid={bad || undefined}
          placeholder={t('assets.linkPlaceholder')}
          onChange={(event) => {
            setUrl(event.currentTarget.value);
            setBad(false);
          }}
        />
        {bad && <p role="alert" className="text-[12px]">{t('moodboard.link.invalid')}</p>}
        <TextField
          label={t('moodboard.link.title')}
          value={title}
          autoComplete="off"
          onChange={(event) => {
            setTitle(event.currentTarget.value);
          }}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t('moodboard.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={url.trim() === ''}>
            {t('moodboard.link.add')}
          </Button>
        </div>
      </form>
    </InAppWindow>
  );
}
