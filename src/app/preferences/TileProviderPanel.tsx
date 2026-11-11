import { useEffect, useState } from 'react';
import { localizeError, t } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { Select, TextField } from '../../ui/fields';
import { loadTileProvider, setTileProvider, tilesOnline, useTileProvider } from '../mapTiles';
import { showInfo } from '../notice';

// Settings → Online services → Map tiles from (4.9): OpenStreetMap's tile server, or a tile server of one's own. Setting
// one makes the app contact that one host, for tiles only, so this says so right here. Rust checks the address (https,
// a host name, {z}, {x} and {y} once each) and keeps it in this computer's app data, never in a project; the page never
// sends it along with a tile request.

/** What the address looks like: a URL, not a word to translate. */
const EXAMPLE = 'https://tiles.example.org/{z}/{x}/{y}.png';

export function TileProviderPanel() {
  const saved = useTileProvider();
  const [own, setOwn] = useState(false);
  const [template, setTemplate] = useState('');
  const [attribution, setAttribution] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadTileProvider();
  }, []);
  // What Rust holds fills the fields once it is read.
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    if (saved) {
      setOwn(true);
      setTemplate(saved.template);
      setAttribution(saved.attribution);
    }
  }

  if (!tilesOnline) {
    return (
      <section className="flex max-w-[560px] flex-col gap-2 border-t border-border p-4" data-tile-provider="">
        <h3 className="sb-label">{t('services.tiles.heading')}</h3>
        <p className="text-[12px] text-text-muted">{t('services.tiles.desktopOnly')}</p>
      </section>
    );
  }

  // The host as typed, so the notice names it before anything is saved (Rust's reading of the address is the one used).
  let typedHost = '';
  try {
    typedHost = new URL(template.replace(/\{[zxy]\}/g, '0')).hostname;
  } catch {
    typedHost = '';
  }
  const host = saved?.host ?? typedHost;

  const use = (nextTemplate: string, nextAttribution: string) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setTileProvider(nextTemplate, nextAttribution).then(
      ({ outcome, host: savedHost }) => {
        setBusy(false);
        // Cancel in the system's question saves nothing: the fields stay as typed.
        if (outcome === 'set') showInfo(t('services.tiles.saved', { host: savedHost }));
        else if (outcome === 'cleared') showInfo(t('services.tiles.savedOsm'));
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(localizeError(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)));
      },
    );
  };

  return (
    <section className="flex max-w-[560px] flex-col gap-2 border-t border-border p-4" data-tile-provider="">
      <Select
        label={t('services.tiles.heading')}
        value={own ? 'own' : 'osm'}
        onChange={(event) => {
          const choice = event.currentTarget.value;
          setProblem(null);
          if (choice === 'osm') {
            setOwn(false);
            if (saved) use('', '');
          } else {
            setOwn(true);
          }
        }}
      >
        <option value="osm">{t('services.tiles.osm')}</option>
        <option value="own">{t('services.tiles.own')}</option>
      </Select>
      {own && (
        <>
          <TextField
            label={t('services.tiles.template')}
            mono
            value={template}
            placeholder={EXAMPLE}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="tile-template-help"
            onChange={(event) => {
              setTemplate(event.currentTarget.value);
            }}
          />
          <p id="tile-template-help" className="text-[12px] text-text-muted">
            {t('services.tiles.templateHelp')}
          </p>
          <TextField
            label={t('services.tiles.attribution')}
            value={attribution}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => {
              setAttribution(event.currentTarget.value);
            }}
          />
          <Button
            className="self-start"
            aria-disabled={busy || undefined}
            onClick={() => {
              use(template, attribution);
            }}
          >
            {t('services.tiles.save')}
          </Button>
          <p className="text-[12px]" role="status">
            {problem ?? (host === '' ? t('services.tiles.contactNone') : t('services.tiles.contact', { host: typedHost || host }))}
          </p>
        </>
      )}
    </section>
  );
}
