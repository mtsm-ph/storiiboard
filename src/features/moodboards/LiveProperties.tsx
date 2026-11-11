import { t } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { copyHex } from '../storyboard/palette/actions';
import { openLiveCard } from './liveActions';
import type { LiveCardData } from './liveCards';

// What the properties strip shows for one selected live card (5.4): a way back to the storyboard, and for a palette card each
// colour's hex to copy (the app's Copy hex, as the palette editor has it). A card on a scene with no palette offers to open the
// scene, where the palette editor is.

interface Props {
  boardId: string;
  id: string;
  data: LiveCardData;
  showTrash: () => void;
}

export function LiveProperties({ boardId, id, data, showTrash }: Props) {
  if (data.kind === 'brand_card') {
    return data.company ? null : (
      <Button
        data-live-open=""
        onClick={() => {
          openLiveCard(boardId, id, showTrash);
        }}
      >
        {t('moodboard.live.openSettings')}
      </Button>
    );
  }
  return (
    <>
      {data.state !== 'gone' && (
        <Button
          data-live-open=""
          onClick={() => {
            openLiveCard(boardId, id, showTrash);
          }}
        >
          {data.state === 'trash' ? t('moodboard.live.openTrash') : data.kind === 'palette_card' ? t('moodboard.live.openPalette') : t('moodboard.live.openStoryboard')}
        </Button>
      )}
      {data.kind === 'palette_card' && data.state === 'live' && data.colors.length > 0 && (
        <div role="group" aria-label={t('moodboard.live.copyHex')} className="flex items-end gap-1">
          {data.colors.map((hex) => (
            <button
              key={hex}
              type="button"
              data-copy-hex={hex}
              aria-label={t('palette.copyHint', { hex })}
              onClick={() => {
                copyHex(hex);
              }}
              className="flex h-8 items-center gap-1 border border-text px-1.5 font-mono text-[12px] hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              <span aria-hidden="true" className="inline-block size-3.5 border border-text" style={{ backgroundColor: hex }} />
              {hex}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
