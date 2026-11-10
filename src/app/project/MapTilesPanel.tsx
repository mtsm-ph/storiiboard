import { useEffect, useRef, useState } from 'react';
import { pluralKey, t, tn } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { Trans } from '../../ui/Trans';
import { confirmForGood } from '../confirm';
import { clearTiles, tilesInfo, type TilesInfo } from '../mapTiles';
import { showInfo, showNotice } from '../notice';
import { decimalSize } from './PlaybackCopies';

// Settings → Storage → Map tiles (4.9): what the map's tile cache takes on this computer (src-tauri/src/tiles.rs keeps
// it under 200 MB, deleting the oldest-read tile first) and Clear. Never in a project; a tile is fetched again, from
// the map service, when its map is looked at.

export function MapTilesPanel() {
  const [info, setInfo] = useState<TilesInfo | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const running = useRef(false);
  const live = useRef(true);

  const read = () =>
    tilesInfo().then(
      (found) => {
        if (live.current) setInfo(found ?? { tiles: 0, bytes: 0, capBytes: 200_000_000 });
      },
      (error: unknown) => {
        if (live.current) showNotice(error);
      },
    );
  useEffect(() => {
    live.current = true;
    void read();
    return () => {
      live.current = false;
    };
  }, []);

  const clear = async () => {
    if (running.current || info === null || info.tiles === 0) return;
    running.current = true;
    try {
      const sure = await confirmForGood(t('storage.clearTilesTitle'), t('storage.clearTilesConfirm'), t('storage.clearTilesAction'));
      if (!sure) return;
      const cleared = await clearTiles();
      showInfo(tn('storage.tilesCleared', cleared));
      await read();
      requestAnimationFrame(() => {
        status.current?.focus();
      });
    } catch (error) {
      showNotice(error);
    } finally {
      running.current = false;
    }
  };

  const mono = (text: string) => <span className="font-mono">{text}</span>;
  return (
    <section data-map-tiles="" className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="sb-label">{t('storageTile.mapTiles')}</h3>
      <p className="text-[12px] text-text-muted">{t('storageTile.mapTilesAre')}</p>
      <p ref={status} tabIndex={-1} className="text-[13px]">
        {info === null ? (
          t('storage.measuring')
        ) : info.tiles === 0 ? (
          t('storage.tiles.none')
        ) : (
          <Trans k={pluralKey('storage.tiles', info.tiles)} parts={{ count: info.tiles, size: mono(decimalSize(info.bytes)), cap: mono(decimalSize(info.capBytes)) }} />
        )}
      </p>
      <Button
        variant="warning"
        className="self-start"
        disabled={info === null || info.tiles === 0}
        onClick={() => {
          void clear();
        }}
      >
        {t('storageTile.clearTiles')}
      </Button>
    </section>
  );
}
