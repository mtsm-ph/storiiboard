import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { getLocale, labels, localizeError, pluralKey, t, tn } from '../../core/i18n';
import { videoFields } from '../../core/media/video';
import { copiesChanged, useCopyQueue } from '../../features/video/playbackCopies';
import { checkVideos } from '../../features/video/videoStatus';
import { Button } from '../../ui/Button';
import { BarGauge, Select, TextField } from '../../ui/fields';
import { InAppWindow } from '../../ui/InAppWindow';
import { Trans } from '../../ui/Trans';
import { confirmForGood } from '../confirm';
import { showInfo, showNotice } from '../notice';
import { LICENCES, playbackDriver, type CopiesInfo, type LicenceName } from '../playback';
import { useProject } from '../projectStore';

// Settings → Storage, for this computer (2.3b): the playback copies (where they are, what they take against their
// cap, the free space they always leave on their drive, Move, Clear), the videos it remembers being handed (2.2b), and
// FFmpeg's licences, as the LGPL asks. They belong to the computer, not a project, so they show with no project open.
// Sizes here are in decimal GB, as the cap and the floor are, and as drives are sold and Finder counts them.

/** "12.4 GB", "640.2 MB": decimal, as the cap and the floor are. Never "KB", so it can't pass for a picture's size. */
export function decimalSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** The app's language's thousands separator: "," in English, "." in Spanish. */
function groupSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1_000_000).find((part) => part.type === 'group')?.value ?? ',';
}

/**
 * A whole number of GB in range, or null for anything else, which leaves the setting as it was. Thousands may be
 * grouped as the app's language writes them ("10,000" in English, "10.000" in Spanish); anything else that isn't a
 * digit (a decimal point, a minus) makes it not a whole number.
 */
export function parseGb(text: string, min: number, max: number, locale: string = getLocale()): number | null {
  const trimmed = text.trim();
  // Grouped only as thousands are ("10,000", "1.000"): a separator anywhere else is a decimal, not a whole number.
  const separator = groupSeparator(locale).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const grouped = new RegExp(`^\\d{1,3}(?:${separator}\\d{3})+$`);
  const plain = grouped.test(trimmed) ? trimmed.replaceAll(groupSeparator(locale), '') : trimmed;
  if (!/^\d+$/.test(plain)) return null;
  const value = Number(plain);
  return value >= min && value <= max ? value : null;
}

/** The cap's and the floor's ranges, as Rust keeps to them (playback.rs). */
export const CAP_GB = { min: 1, max: 10_000 } as const;
export const FLOOR_GB = { min: 1, max: 1_000 } as const;

/** A save of the cap or the floor: whether it was saved (undefined counts as saved). */
type GbSave = (gb: number) => Promise<boolean> | undefined;

interface GbFieldProps {
  label: string;
  saved: number;
  range: { min: number; max: number };
  helpId: string;
  onChange: GbSave;
  /** Not a whole number in range: the field goes back to what's saved, and this says why. */
  onOutOfRange: () => void;
}

function GbField({ label, saved, range, helpId, onChange, onOutOfRange }: GbFieldProps) {
  const [draft, setDraft] = useState(String(saved));
  // A new value saved shows (the same field stays, and focus with it); one refused or not saved snaps back below.
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    // Unless the person has typed on since (after Enter, focus stays here): theirs stays, to be saved in turn.
    if (draft === String(shown) || parseGb(draft, range.min, range.max) === saved) setDraft(String(saved));
  }
  // The value being saved now, so Enter then Tab saves it once.
  const saving = useRef<number | null>(null);
  const commit = () => {
    const value = parseGb(draft, range.min, range.max);
    if (value === null) {
      setDraft(String(saved));
      onOutOfRange();
    } else if (value !== saved && value !== saving.current) {
      saving.current = value;
      void Promise.resolve(onChange(value)).then((done) => {
        saving.current = null;
        if (done === false) setDraft(String(saved));
      });
    }
  };
  return (
    <TextField
      label={label}
      mono
      inputMode="numeric"
      value={draft}
      aria-describedby={helpId}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        // Saved where it is: focus stays in the field.
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

export interface PlaybackCopiesViewProps {
  /** Null while it's read, or when it couldn't be (`infoError`). */
  info: CopiesInfo | null;
  /** Why the copies couldn't be read, in Rust's words; null when they were, or while they're read. */
  infoError?: string | null;
  /** The copy being made now (its file's name), how far along, and how many wait their turn. */
  queue: { name: string | null; done: number | null; waiting: number };
  /** Videos remembered; null while counted. */
  known: number | null;
  /** A Move is running. */
  moving: boolean;
  copiesStatus?: RefObject<HTMLParagraphElement | null>;
  knownStatus?: RefObject<HTMLParagraphElement | null>;
  onCapChange: GbSave;
  onFloorChange: GbSave;
  /** An entry for the cap or the floor that isn't a whole number in range. */
  onOutOfRange?: (which: 'cap' | 'floor') => void;
  onMove: () => void;
  onMoveBack: () => void;
  onClear: () => void;
  onForget: () => void;
  onLicences: () => void;
}

/** This part only draws. */
export function PlaybackCopiesView({
  info,
  infoError = null,
  queue,
  known,
  moving,
  copiesStatus,
  knownStatus,
  onCapChange,
  onFloorChange,
  onOutOfRange = () => undefined,
  onMove,
  onMoveBack,
  onClear,
  onForget,
  onLicences,
}: PlaybackCopiesViewProps) {
  const helpId = useId();
  const mono = (text: string) => <span className="font-mono">{text}</span>;
  return (
    <>
      <section data-playback-copies="" className="flex flex-col gap-2">
        <h3 className="sb-label">{t('storageTile.playbackCopies')}</h3>
        <p className="text-[12px] text-text-muted">{t('storageTile.playbackCopiesAre')}</p>
        <p ref={copiesStatus} tabIndex={-1} className="text-[13px]">
          {info === null ? (
            infoError === null ? (
              t('storage.measuring')
            ) : (
              localizeError(infoError)
            )
          ) : info.copies === 0 ? (
            t('storage.noCopies')
          ) : (
            <Trans k={pluralKey('storage.copies', info.copies)} parts={{ count: info.copies, size: mono(decimalSize(info.bytes)), cap: mono(`${String(info.capGb)} GB`) }} />
          )}
        </p>
        {info !== null && info.copies > 0 && <BarGauge label={t('storageTile.ofTheCap')} value={info.bytes} max={info.capGb * 1e9} />}
        {queue.name !== null && (
          <p className="text-[12px]">
            <Trans
              k={queue.done === null ? 'storage.makingCopy' : 'storage.makingCopyDone'}
              parts={{ name: <span data-user-text="" className="font-mono">{queue.name}</span>, done: Math.round((queue.done ?? 0) * 100) }}
            />
            {queue.waiting > 0 && ` ${tn('storage.copiesWaiting', queue.waiting)}`}
          </p>
        )}
        {info !== null && (
          <>
            <p data-user-text="" className="font-mono text-[11px] break-all text-text-muted">
              {info.folder}
            </p>
            {info.fallback && <p className="text-[12px]">{t('storage.copiesFallback')}</p>}
            <p className="text-[12px]">
              {info.freeBytes === null ? (
                <Trans k="storage.copiesFloorOnly" parts={{ floor: mono(`${String(info.floorGb)} GB`) }} />
              ) : (
                <Trans k="storage.copiesFree" parts={{ free: mono(decimalSize(info.freeBytes)), floor: mono(`${String(info.floorGb)} GB`) }} />
              )}
            </p>
            <div className="grid max-w-[420px] grid-cols-2 gap-3">
              <GbField
                label={t('storageTile.copiesCap')}
                saved={info.capGb}
                range={CAP_GB}
                helpId={helpId}
                onChange={onCapChange}
                onOutOfRange={() => {
                  onOutOfRange('cap');
                }}
              />
              <GbField
                label={t('storageTile.copiesFloor')}
                saved={info.floorGb}
                range={FLOOR_GB}
                helpId={helpId}
                onChange={onFloorChange}
                onOutOfRange={() => {
                  onOutOfRange('floor');
                }}
              />
            </div>
            <p id={helpId} className="text-[12px] text-text-muted">
              {t('storageTile.copiesCapAndFloor')}
            </p>
          </>
        )}
        {/* Unreadable, the copies may be where they were moved: Move back is the way to this computer's folder. */}
        {(info !== null || infoError !== null) && (
          <div className="flex flex-wrap items-center gap-3">
            {/* aria-disabled while it runs, so focus stays on the button; the handler ignores a second click. */}
            <Button aria-disabled={moving} aria-busy={moving} onClick={onMove}>
              {moving ? t('storage.movingCopies') : t('storageTile.moveCopies')}
            </Button>
            {(info === null || info.moved) && (
              <Button aria-disabled={moving} onClick={onMoveBack}>
                {t('storageTile.moveCopiesBack')}
              </Button>
            )}
            {info !== null && (
              <Button variant="warning" disabled={info.copies === 0} onClick={onClear}>
                {t('storageTile.clearCopies')}
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">{t('storageTile.rememberedVideos')}</h3>
        <p ref={knownStatus} tabIndex={-1} className="text-[13px]">
          {known === null ? t('storage.counting') : known === 0 ? t('storage.noKnownVideos') : tn('storage.knownVideos', known)}
        </p>
        <p className="text-[12px] text-text-muted">{t('storageTile.rememberedVideosAre')}</p>
        <Button variant="warning" className="self-start" disabled={known === null || known === 0} onClick={onForget}>
          {t('storageTile.forgetVideos')}
        </Button>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">{t('storageTile.ffmpeg')}</h3>
        <p className="text-[12px] text-text-muted">{t('storageTile.ffmpegIs')}</p>
        <Button className="self-start" onClick={onLicences}>
          {t('storageTile.licences')}
        </Button>
      </section>
    </>
  );
}

const LICENCE_LABEL = labels<LicenceName>({
  'ffmpeg-LICENSE.txt': 'licences.ffmpegLgpl',
  'ffmpeg-LICENSE.md': 'licences.ffmpegNotes',
  'zimg-LICENSE.txt': 'licences.zimg',
  'dav1d-LICENSE.txt': 'licences.dav1d',
  'ffmpeg-SOURCE.txt': 'licences.sources',
  'fonts-archivo-OFL.txt': 'licences.fontArchivo',
  'fonts-bodonimoda-OFL.txt': 'licences.fontBodoniModa',
  'fonts-intertight-OFL.txt': 'licences.fontInterTight',
  'fonts-jetbrainsmono-OFL.txt': 'licences.fontJetbrainsMono',
  'fonts-jost-OFL.txt': 'licences.fontJost',
  'fonts-outfit-OFL.txt': 'licences.fontOutfit',
});

/** The licences, one at a time, as they ship: plain text, scrollable, in mono. */
function LicencesWindow({ onClose }: { onClose: () => void }) {
  const [chosen, setChosen] = useState<LicenceName>('ffmpeg-LICENSE.txt');
  // By the licence it's of, so another one picked shows "Reading…" until its own text comes.
  const [read, setRead] = useState<{ name: LicenceName; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    playbackDriver
      .licence(chosen)
      .then((text) => {
        if (live) setRead({ name: chosen, text });
      })
      .catch((error: unknown) => {
        if (live) setRead({ name: chosen, text: localizeError(error instanceof Error ? error.message : String(error)) });
      });
    return () => {
      live = false;
    };
  }, [chosen]);
  return (
    <InAppWindow title={t('licences.title')} onClose={onClose} width={760} height={600}>
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="max-w-[320px]">
          <Select
            label={t('licences.which')}
            value={chosen}
            onChange={(event) => {
              setChosen(event.currentTarget.value as LicenceName);
            }}
          >
            {LICENCES.map((name) => (
              <option key={name} value={name}>
                {LICENCE_LABEL[name]}
              </option>
            ))}
          </Select>
        </div>
        {/* Read-only text: reached with Tab, scrolled with the keyboard, read as text. */}
        <textarea
          readOnly
          aria-label={LICENCE_LABEL[chosen]}
          value={read?.name === chosen ? read.text : t('storage.reading')}
          className="min-h-0 flex-1 resize-none overflow-auto border border-border bg-surface-raised p-3 font-mono text-[11px] text-text"
        />
      </div>
    </InAppWindow>
  );
}

/** The copies' section, with what it does: it reads the copies again after every action, and a Move whatever it said. */
export function PlaybackCopiesPanel() {
  const records = useProject((s) => s.records);
  const queue = useCopyQueue();
  const [info, setInfo] = useState<CopiesInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [known, setKnown] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [licences, setLicences] = useState(false);
  // One action at a time, held in a ref so the buttons stay enabled (and focused) while a confirm is up.
  const running = useRef(false);
  const live = useRef(true);
  const copiesStatus = useRef<HTMLParagraphElement>(null);
  const knownStatus = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /**
   * Reads the copies again. Never read yet, they say why in place of their count; read before, the figures stay and a
   * notice says they couldn't be read again.
   */
  const readOnce = useRef(false);
  const readInfo = () =>
    playbackDriver.info().then(
      (read) => {
        if (!live.current) return;
        readOnce.current = true;
        setInfo(read);
        setInfoError(null);
      },
      (error: unknown) => {
        if (!live.current) return;
        if (readOnce.current) showNotice(error);
        else setInfoError(error instanceof Error ? error.message : String(error));
      },
    );
  const readKnown = () =>
    playbackDriver.knownCount().then((count) => {
      if (live.current) setKnown(count);
    }, showNotice);

  // Read when shown, and as each copy finishes (the one being made changes).
  useEffect(() => {
    void readInfo();
  }, [queue.making]);
  useEffect(() => {
    void readKnown();
  }, []);

  const making = queue.making ? records[queue.making] : undefined;
  const name = making?.type === 'media' ? (videoFields(making.props)?.sourceName ?? null) : null;

  /**
   * Runs an action once at a time. `work` says whether it did anything: then the copies are read again first and focus
   * goes to the line that says how they are now; a confirm or a folder dialog cancelled leaves focus where it was.
   */
  const act = async (work: () => Promise<boolean>, status: RefObject<HTMLParagraphElement | null>) => {
    if (running.current) return;
    running.current = true;
    let did = false;
    try {
      did = await work();
    } catch (error) {
      showNotice(error);
    } finally {
      await Promise.all([readInfo(), readKnown()]);
      running.current = false;
      if (did && live.current) {
        requestAnimationFrame(() => {
          status.current?.focus();
        });
      }
    }
  };

  /**
   * Saves the cap or the floor, beside any action running (Rust takes one change at a time): focus stays where the
   * person took it, and the field goes back to what's saved if it wasn't.
   */
  const save = async (work: () => Promise<void>, after?: () => void): Promise<boolean> => {
    let saved = false;
    try {
      await work();
      after?.();
      saved = true;
    } catch (error) {
      showNotice(error);
    }
    await readInfo();
    return saved;
  };

  const move = (back: boolean) =>
    act(async () => {
      // Said before the folder is asked for, not after: Rust moves nothing while a copy is being made.
      if (queue.making !== null || info?.busy === true) {
        showNotice(t('error.copyBusy'));
        return false;
      }
      setMoving(true);
      try {
        const moved = back ? await playbackDriver.moveBack() : await playbackDriver.move();
        if (moved === null) return false;
        showInfo(tn('storage.copiesMoved', moved));
        return true;
      } finally {
        if (live.current) setMoving(false);
        // Where each copy is changed, or may have: the inspector looks again.
        copiesChanged();
      }
    }, copiesStatus);

  return (
    <>
      <PlaybackCopiesView
        info={info}
        infoError={infoError}
        queue={{ name, done: queue.done, waiting: queue.waiting }}
        known={known}
        moving={moving}
        copiesStatus={copiesStatus}
        knownStatus={knownStatus}
        // A lower cap removes copies at once: the inspector looks again. Each save is said, as focus stays in its field.
        onCapChange={(gb) =>
          save(
            () => playbackDriver.setCap(gb),
            () => {
              copiesChanged();
              showInfo(t('storage.capSaved', { gb }));
            },
          )
        }
        onFloorChange={(gb) =>
          save(
            () => playbackDriver.setFloor(gb),
            () => {
              showInfo(t('storage.floorSaved', { gb }));
            },
          )
        }
        onOutOfRange={(which) => {
          showNotice(t(which === 'cap' ? 'error.copyCap' : 'error.copyFloor'));
        }}
        onMove={() => {
          if (!moving) void move(false);
        }}
        onMoveBack={() => {
          if (!moving) void move(true);
        }}
        onClear={() => {
          void act(async () => {
            const count = info?.copies ?? 0;
            const sure = await confirmForGood(t('storage.clearCopiesTitle'), tn('storage.clearCopiesConfirm', count), t('storage.clearCopiesAction'));
            if (!sure) return false;
            const cleared = await playbackDriver.clear();
            copiesChanged();
            showInfo(tn('storage.copiesCleared', cleared));
            return true;
          }, copiesStatus);
        }}
        onForget={() => {
          void act(async () => {
            const sure = await confirmForGood(t('storage.forgetVideosTitle'), t('storage.forgetVideosConfirm'), t('storage.forgetVideosAction'));
            if (!sure) return false;
            await playbackDriver.forgetKnown();
            showInfo(t('storage.videosForgotten'));
            // Videos outside a project's folder can't be read now: their frames say so, with Relink.
            await checkVideos();
            return true;
          }, knownStatus);
        }}
        onLicences={() => {
          setLicences(true);
        }}
      />
      {licences && (
        <LicencesWindow
          onClose={() => {
            setLicences(false);
          }}
        />
      )}
    </>
  );
}
