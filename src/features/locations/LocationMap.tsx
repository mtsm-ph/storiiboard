import type Konva from 'konva';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Image as KonvaImage, Rect, Stage } from 'react-konva';
import { loadTileProvider, TileDropped, tileImage, tileProblem, tilesOnline, useTileProvider, useTileProviderFailed, useTileProviderLoaded, wantTiles } from '../../app/mapTiles';
import { openLink } from '../../app/opener';
import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { clampZoom, fromScreen, panned, START_ZOOM, tilesInView, toScreen, zoomedAround, type LatLon } from '../../core/model/mercator';
import { coordinatesLabel, type Place } from '../../core/net/places';
import { Button } from '../../ui/Button';
import { movePin } from './locationEdits';
import { mapCredit, MAP_HEIGHT, onScreen, pinAfterKey, viewAfterKey, viewZoomed, type MapView } from './mapView';

// The map under a location's place (4.9), drawn with react-konva from OpenStreetMap's tiles, which Rust fetches and
// keeps (src-tauri/src/tiles.rs; the page asks only for the tiles in view). Drag the map to pan, scroll or press the
// buttons to zoom; drag the pin to where the crew should go (an entrance, a basecamp) and let go: that saves the
// location's place in one edit. From the keyboard: arrows pan, + and - zoom, and Move pin then the arrows moves the
// pin, Enter places it, Escape cancels. The credit is always on the map. A browser build has no tiles and draws a
// plain grid, so the tests need no network. When the tiles fail (offline, refused, switched off) the squares stay grey,
// one line says why and the pin still works.

/**
 * The colours Konva needs as real values: the theme's, read from <html> as the sketch editor reads its ink. The
 * fallbacks are system colour keywords, not brand values; the theme's tokens are always there in the app.
 */
function themeColours() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { ink: read('--text', 'CanvasText'), paper: read('--surface', 'Canvas'), raised: read('--surface-raised', 'ButtonFace'), rule: read('--border', 'GrayText') };
}

interface LocationMapProps {
  locationId: string;
  place: Place;
  /** The pin was placed by hand (`map_moved`): said under the map. */
  moved: boolean;
  /**
   * The call sheet's map (4.10): zoom 16 centred on the place, no panning, zooming or pin dragging, and none of the
   * controls. It is a view like the Locations tile's, so its tiles load under the same rules and land in the same cache.
   */
  readOnly?: boolean;
  /** The map's height in pixels (the editor's is taller than the sheet's). */
  height?: number;
}

type Loaded = ReadonlyMap<string, HTMLImageElement | null>;

export function LocationMap({ locationId, place, moved, readOnly = false, height = MAP_HEIGHT }: LocationMapProps) {
  const helpId = useId();
  const provider = useTileProvider();
  const frame = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(360);
  // Tiles are asked for only once the column is measured, so the first request is for the view that will be seen.
  const [measured, setMeasured] = useState(false);
  const [view, setView] = useState<MapView>({ center: { latitude: place.latitude, longitude: place.longitude }, zoom: START_ZOOM });
  // The pin while it is being dragged or moved from the keyboard, and whether the keyboard is moving it.
  const [draft, setDraft] = useState<LatLon | null>(null);
  const [moving, setMoving] = useState(false);
  const [said, setSaid] = useState('');
  const [loaded, setLoaded] = useState<Loaded>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const lastWheel = useRef(0);
  const [colours, setColours] = useState(themeColours);
  const providerLoaded = useTileProviderLoaded();
  const providerFailed = useTileProviderFailed();

  useEffect(() => {
    void loadTileProvider();
  }, []);

  // The colours follow the theme: light and dark, or a project's own, switched while the map is open.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColours(themeColours());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      observer.disconnect();
    };
  }, []);

  // Tiles of another server are not this one's: what is drawn goes when the server changes.
  const providerKey = provider ? `${provider.host}|${provider.template}` : '';
  const [seenProvider, setSeenProvider] = useState(providerKey);
  if (seenProvider !== providerKey) {
    setSeenProvider(providerKey);
    setLoaded(new Map());
  }

  // The width follows the tile's column.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      setWidth(Math.max(120, Math.round(element.clientWidth)));
      setMeasured(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The place changed under the map (a new pick, an undo): the map follows when the pin would be off screen.
  const { latitude, longitude } = place;
  const [seen, setSeen] = useState({ latitude, longitude });
  if (seen.latitude !== latitude || seen.longitude !== longitude) {
    setSeen({ latitude, longitude });
    if (readOnly || !onScreen({ latitude, longitude }, view, width, height)) setView({ ...view, center: { latitude, longitude } });
  }

  const tiles = useMemo(() => tilesInView(view.center, view.zoom, width, height), [view, width, height]);

  // The queue forgets what is queued when the map goes.
  useEffect(
    () => () => {
      wantTiles([], helpId);
    },
    [helpId],
  );

  // Only the tiles in view are asked for, and none ahead; a browser build asks for none at all, and nothing is asked
  // for before the column is measured and Rust has said which server the tiles come from.
  useEffect(() => {
    if (!tilesOnline) return;
    if (providerFailed || !measured || !providerLoaded) return;
    let live = true;
    // Tiles of a view already left, still waiting, are dropped before they are asked for.
    wantTiles(tiles, helpId);
    for (const tile of tiles) {
      const key = `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
      void tileImage(tile.z, tile.x, tile.y).then(
        (image) => {
          if (!live) return;
          setProblem(null);
          setLoaded((now) => (now.get(key) === image ? now : new Map(now).set(key, image)));
        },
        (error: unknown) => {
          if (!live || error instanceof TileDropped) return;
          setProblem(tileProblem(error));
          setLoaded((now) => (now.get(key) === null ? now : new Map(now).set(key, null)));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [tiles, measured, providerLoaded, providerFailed, providerKey, helpId]);

  const shown: LatLon = draft ?? { latitude, longitude };
  const pin = toScreen(shown, view.center, view.zoom, width, height);
  const credit = mapCredit(provider);

  const save = (to: LatLon) => {
    setDraft(to);
    // Whether this is a change at all, so a drop on the same spot isn't taken for a failure.
    const change = movePin(projectStore.getState().records, locationId, to.latitude, to.longitude).length > 0;
    return projectStore
      .getState()
      .applyWith((now) => ({ changes: movePin(now, locationId, to.latitude, to.longitude) }))
      .then(
        (written) => {
          // The pin shows the stored place again (it is the same one when it was written).
          setDraft(null);
          if (written) setSaid(t('map.pinPlaced', { coordinates: coordinatesLabel(to) }));
          else if (change) showNotice(new Error(t('map.pinNotSaved')));
        },
        (error: unknown) => {
          setDraft(null);
          showNotice(error);
        },
      );
  };

  const finishMove = (place: boolean) => {
    const to = draft;
    setMoving(false);
    if (place && to) void save(to);
    else setDraft(null);
    requestAnimationFrame(() => {
      moveButton.current?.focus();
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (moving) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishMove(true);
        return;
      }
      if (event.key === 'Escape') {
        // Not the window's: this only ends the move.
        event.preventDefault();
        event.stopPropagation();
        finishMove(false);
        return;
      }
      const next = pinAfterKey(draft ?? { latitude, longitude }, view, event.key, event.shiftKey, width, height);
      if (next) {
        event.preventDefault();
        setDraft(next);
        // The pin never leaves the map: it carries the view along.
        if (!onScreen(next, view, width, height)) setView({ ...view, center: next });
        return;
      }
    }
    // Zoom keys work while moving the pin too; the arrows then belong to the pin (handled above).
    const next = moving && event.key.startsWith('Arrow') ? null : viewAfterKey(view, event.key, event.shiftKey, width, height);
    if (next) {
      event.preventDefault();
      setView(next);
    }
  };

  const grid = !tilesOnline;
  return (
    <div className="flex flex-col gap-1" {...(readOnly ? { 'data-sheet-map': '' } : { 'data-location-map': '' })}>
      <div ref={frame} className="relative w-full" style={{ height }}>
        {/* A canvas can't be read or reached by itself: this region takes the keys, and the buttons below do the rest.
            jsx-a11y counts application as non-interactive, as in the crop editor. The call sheet's map is a picture only. */}
        <div
          ref={region}
          role={readOnly ? 'img' : 'application'}
          tabIndex={readOnly ? undefined : 0}
          aria-label={t('map.label', { name: place.name })}
          aria-describedby={readOnly ? undefined : helpId}
          onKeyDown={readOnly ? undefined : onKeyDown}
          className="h-full w-full overflow-hidden border border-border bg-surface-raised"
        >
          <Stage
            ref={stage}
            width={width}
            height={height}
            draggable={!readOnly}
            onDragEnd={(event) => {
              // The pin's own drag ends bubble up here; only the map's is a pan.
              if (event.target !== event.target.getStage()) return;
              const at = event.target.position();
              event.target.position({ x: 0, y: 0 });
              setView((now) => ({ ...now, center: panned(now.center, now.zoom, -at.x, -at.y) }));
            }}
            onWheel={(event) => {
              // The wheel zooms the map only when it has focus (click it, or Tab to it), or with Ctrl or ⌘ held;
              // otherwise it scrolls the editor past, as it does anywhere else. A wheel with no vertical turn is no zoom.
              if (readOnly) return;
              const asked = event.evt.ctrlKey || event.evt.metaKey || document.activeElement === region.current;
              if (!asked || event.evt.deltaY === 0) return;
              event.evt.preventDefault();
              const now = Date.now();
              // One step at a time, however fast a trackpad scrolls.
              if (now - lastWheel.current < 150) return;
              lastWheel.current = now;
              const at = stage.current?.getPointerPosition() ?? { x: width / 2, y: height / 2 };
              setView((v) => {
                const next = zoomedAround(v.center, v.zoom, clampZoom(v.zoom + (event.evt.deltaY < 0 ? 1 : -1)), at, width, height);
                return { center: next.center, zoom: next.zoom };
              });
            }}
          >
            <Layer listening={false}>
              {tiles.map((tile) => {
                const key = `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
                const image = loaded.get(key);
                const left = Math.round(tile.left);
                const top = Math.round(tile.top);
                return image ? (
                  <KonvaImage key={`${key}@${String(left)},${String(top)}`} image={image} x={left} y={top} width={256} height={256} />
                ) : (
                  // A grey tile while it loads or when it can't (and every tile of a browser build's grid).
                  <Rect key={`${key}@${String(left)},${String(top)}`} x={left} y={top} width={256} height={256} fill={colours.raised} stroke={colours.rule} strokeWidth={grid ? 1 : 0.5} />
                );
              })}
            </Layer>
            <Layer>
              <Group
                x={pin.x}
                y={pin.y}
                draggable={!readOnly}
                onMouseEnter={(event) => {
                  // A pin that can't be dragged doesn't offer to be.
                  if (readOnly) return;
                  event.target.getStage()?.container().style.setProperty('cursor', 'grab');
                }}
                onMouseLeave={(event) => {
                  event.target.getStage()?.container().style.removeProperty('cursor');
                }}
                onDragStart={(event) => {
                  event.cancelBubble = true;
                }}
                onDragMove={(event) => {
                  event.cancelBubble = true;
                }}
                onDragEnd={(event) => {
                  event.cancelBubble = true;
                  const at = event.target.position();
                  void save(fromScreen(at, view.center, view.zoom, width, height));
                }}
              >
                {/* The pin: an ink ring with a paper dot, readable on any tile; the map's selection is ink, never orange. */}
                <Circle radius={11} fill={colours.paper} stroke={colours.ink} strokeWidth={2} hitStrokeWidth={14} />
                <Circle radius={5} fill={colours.ink} />
              </Group>
            </Layer>
          </Stage>
        </div>
        {/* The credit sits on the map itself, always (OpenStreetMap's tile policy). Its link is a button that opens the
            page through the app (open.rs), so a middle-click or a drag can't open it any other way. */}
        <p className="absolute right-0 bottom-0 bg-surface px-1.5 py-0.5 text-[10px] text-text" {...(readOnly ? { 'data-sheet-map-credit': '' } : { 'data-map-credit': '' })}>
          {credit.href === null ? (
            credit.text
          ) : (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                void openLink(credit.href ?? '').catch(showNotice);
              }}
            >
              {credit.text}
            </button>
          )}
        </p>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label={t('map.zoomIn')}
            aria-disabled={view.zoom >= 19 || undefined}
            onClick={() => {
              // At the limit it stays focused and does nothing.
              if (view.zoom < 19) setView((v) => viewZoomed(v, 1, width, height));
            }}
          >
            +
          </Button>
          <Button
            aria-label={t('map.zoomOut')}
            aria-disabled={view.zoom <= 0 || undefined}
            onClick={() => {
              if (view.zoom > 0) setView((v) => viewZoomed(v, -1, width, height));
            }}
          >
            −
          </Button>
          <span className="font-mono text-[11px]" data-map-zoom="">
            {t('map.zoomLevel', { zoom: view.zoom })}
          </span>
          {moving ? (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  finishMove(true);
                }}
              >
                {t('map.placePin')}
              </Button>
              <Button
                onClick={() => {
                  finishMove(false);
                }}
              >
                {t('map.cancelPin')}
              </Button>
            </>
          ) : (
            <Button
              ref={moveButton}
              onClick={() => {
                setDraft({ latitude, longitude });
                setMoving(true);
                setSaid('');
                region.current?.focus();
              }}
            >
              {t('map.movePin')}
            </Button>
          )}
        </div>
      )}
      {!readOnly && (
        <p id={helpId} className="text-[11px] text-text-muted">
          {t('map.help')}
        </p>
      )}
      {grid && <p className="text-[12px]">{t('map.browserOnly')}</p>}
      {(providerFailed || problem !== null) && <p className="text-[12px]">{t('map.tilesFailed', { why: providerFailed ? t('error.oddAnswer') : (problem ?? '') })}</p>}
      {!readOnly && moved && !moving && <p className="text-[12px]" data-map-hand="">{t('map.handPlaced')}</p>}
      {/* Always in the page, so each new line is read out; out of sight while empty. */}
      {!readOnly && (
        <p role="status" className={moving || said !== '' ? 'font-mono text-[12px]' : 'sr-only'} data-map-status="">
          {moving ? t('map.moving', { coordinates: coordinatesLabel(shown) }) : said}
        </p>
      )}
    </div>
  );
}
