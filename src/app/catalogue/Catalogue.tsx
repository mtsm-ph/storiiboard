import { useState, type ReactNode } from 'react';
import { DEPARTMENTS } from '../../core/model/department';
import { SHOT_STATUSES } from '../../core/model/shotStatus';
import { Button, IconButton } from '../../ui/Button';
import { BarGauge, Select, Slider, TextField, Toggle } from '../../ui/fields';
import { PlayGlyph } from '../../ui/glyphs';
import { PLAN_ICONS, planIconDataUrl } from '../../ui/icons/plan/planIcons';
import { SMark } from '../../ui/logo/SMark';
import { Wordmark } from '../../ui/logo/Wordmark';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { ConflictChip, DepartmentTag, GoldenHourChip, StatusGlyph } from '../../ui/tags';
import { ThemeSwitch } from '../../ui/theme/ThemeSwitch';
import { Tile } from '../../ui/Tile';
import { ProjectsView } from '../projects/ProjectsView';

// Dev-only page (open the app at #catalogue): every primitive and state, in whichever theme is active.
// It doubles as the "stories" for src/ui and as the page the end-to-end keyboard tests drive.

// Sample entries for the Projects screen, which the browser build can't reach with real files.
const SAMPLE_RECENT = [
  { path: '/Users/kevin/Films/Bey County.sbd', name: 'Bey County', openedAt: '2026-11-02T14:05:00.000Z' },
  { path: '/Volumes/Jobs/Parfum No. 7.sbd', name: 'Parfum No. 7', openedAt: '2026-10-28T09:30:00.000Z' },
];
const noop = () => undefined;

const T_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11] as const;
type TStop = (typeof T_STOPS)[number];
type IntExt = 'int' | 'ext' | 'int-ext';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border border-rule bg-panel p-4">
      <h2 className="sb-label font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function Catalogue() {
  const [tab, setTab] = useState('sc04');
  const [maximized, setMaximized] = useState(false);
  const [intExt, setIntExt] = useState<IntExt>('int');
  const [tStop, setTStop] = useState<TStop>(2);
  const [snap, setSnap] = useState(true);

  return (
    <main className="sb-grain flex min-h-full flex-col gap-gap p-6 text-ink">
      <div className="flex items-center justify-between">
        <h1 className="text-[32px] font-extrabold tracking-[-0.02em]">UI catalogue</h1>
        <ThemeSwitch />
      </div>

      <div className="grid grid-cols-2 gap-gap">
        <Section title="Logo">
          {/* Two marks, never combined: each gets its own ruled cell, as on the kit's logo sheet. */}
          <div className="flex flex-col border border-rule">
            <div className="border-b border-rule p-4">
              <Wordmark height={40} />
            </div>
            <div className="flex flex-wrap items-end gap-6 p-4">
              {/* The inline of the full mark matches what is behind it: the panel. */}
              <SMark size={96} label="S mark, full" inline="var(--sb-panel)" />
              <SMark size={48} label="S mark, 48px" inline="var(--sb-panel)" />
              <SMark size={32} label="S mark, 32px (solid)" />
              <SMark size={16} label="S mark, 16px (solid)" />
            </div>
          </div>
        </Section>

        <Section title="Tile">
          <Tile
            index={2}
            title="Storyboard"
            meta="06"
            tabs={[
              { id: 'sc04', label: 'SC 04' },
              { id: 'sc05', label: 'SC 05' },
            ]}
            activeTab={tab}
            onTabChange={setTab}
            maximized={maximized}
            onToggleMaximize={() => {
              setMaximized((m) => !m);
            }}
            onClose={() => undefined}
            className="h-40"
          >
            <p className="sb-label p-3 text-muted">Open tab: {tab === 'sc04' ? 'SC 04' : 'SC 05'}</p>
          </Tile>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="primary">Capture frame</Button>
            <Button>Add to shoot day</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="warning">Delete scene</Button>
            <Button disabled>Export PDF</Button>
            <IconButton label="Play">
              <PlayGlyph />
            </IconButton>
            <Button mono aria-label="Mark in">
              [ IN
            </Button>
            <Button mono aria-label="Mark out">
              OUT ]
            </Button>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Shot" mono defaultValue="4B" />
            <Select label="Lens" mono defaultValue="35mm">
              <option>24mm</option>
              <option>35mm</option>
              <option>50mm</option>
              <option>85mm</option>
            </Select>
          </div>
          <SegmentedControl
            label="Int / Ext"
            options={[
              { value: 'int', label: 'Int' },
              { value: 'ext', label: 'Ext' },
              { value: 'int-ext', label: 'Int/Ext' },
            ]}
            value={intExt}
            onChange={setIntExt}
          />
          <Slider label="T-stop" stops={T_STOPS} value={tStop} onChange={setTStop} format={(t) => `T${t.toFixed(1)}`} />
          <BarGauge label="Scene coverage" value={67} />
          <Toggle label="Snap tiles to edges" checked={snap} onChange={setSnap} />
        </Section>

        <Section title="Tags and status">
          <div className="flex flex-wrap gap-1.5">
            {DEPARTMENTS.map((department) => (
              <DepartmentTag key={department} department={department} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            {SHOT_STATUSES.map((status) => (
              <StatusGlyph key={status} status={status} showLabel />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <GoldenHourChip time="15:52" />
            <ConflictChip>Day 02</ConflictChip>
          </div>
        </Section>

        <Section title="Projects screen">
          <div className="flex h-[300px] flex-col">
            <ProjectsView
              recent={SAMPLE_RECENT}
              openPath={SAMPLE_RECENT[0]?.path ?? null}
              canOpen
              onNew={noop}
              onOpen={noop}
              onOpenRecent={noop}
              onForget={noop}
            />
          </div>
        </Section>

        <Section title={`Plan icons (${String(PLAN_ICONS.length)})`}>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {PLAN_ICONS.map((icon) => (
              // The kit draws these in fixed ink, so they sit on paper in both themes.
              <li
                key={icon.id}
                className="flex flex-col items-center gap-1 border border-rule bg-paper-fixed p-2 text-ink-fixed"
              >
                <img src={planIconDataUrl(icon)} alt="" width={32} height={32} />
                <span className="sb-label text-center">{icon.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
