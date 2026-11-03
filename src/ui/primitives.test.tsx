import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEPARTMENTS } from '../core/model/department';
import { Button, IconButton } from './Button';
import { BarGauge, Slider, TextField, Toggle } from './fields';
import { SegmentedControl } from './SegmentedControl';
import { departmentTagClass, DepartmentTag, StatusGlyph } from './tags';
import { Tile } from './Tile';

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('Button', () => {
  it('keeps orange for primary, with ink text, and never submits forms by accident', () => {
    const html = renderToString(<Button variant="primary">Capture frame</Button>);
    expect(html).toContain('bg-accent');
    expect(html).toContain('text-accent-contrast');
    expect(html).toContain('type="button"');
  });

  it('only uses orange on primary', () => {
    for (const variant of ['secondary', 'ghost', 'warning'] as const) {
      expect(renderToString(<Button variant={variant}>x</Button>)).not.toContain('accent');
    }
  });

  it('edges primary buttons in orange in dark mode, except when disabled', () => {
    expect(renderToString(<Button variant="primary">x</Button>)).toContain('dark:enabled:border-accent');
  });

  it('draws the focus ring inside the small title-bar buttons, which sit against a clipped edge', () => {
    expect(renderToString(<IconButton label="Close" size="sm">×</IconButton>)).toContain('focus-visible:-outline-offset-2');
  });

  it('keeps the small title-bar buttons at 24px, the smallest target WCAG 2.2 allows', () => {
    expect(renderToString(<IconButton label="Close" size="sm">×</IconButton>)).toContain('size-[24px]');
  });

  it('pads mono buttons tighter, with a single padding class', () => {
    const html = renderToString(<Button mono>[ IN</Button>);
    expect(html).toContain('px-2.5');
    expect(html).not.toContain('px-3.5');
  });

  it('names icon buttons for screen readers and as a tooltip', () => {
    const html = renderToString(<IconButton label="Play">▶</IconButton>);
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('title="Play"');
  });
});

describe('SegmentedControl', () => {
  const html = renderToString(
    <SegmentedControl
      label="Int / Ext"
      options={[
        { value: 'int', label: 'Int' },
        { value: 'ext', label: 'Ext' },
      ]}
      value="ext"
      onChange={() => undefined}
    />,
  );

  it('is a radio group with one checked option and one tab stop', () => {
    expect(html).toContain('role="radiogroup"');
    expect(count(html, 'role="radio"')).toBe(2);
    expect(count(html, 'aria-checked="true"')).toBe(1);
    expect(count(html, 'tabindex="0"')).toBe(1);
  });

  it('marks the selection with an ink fill, not orange, and keeps its focus ring visible on the fill', () => {
    expect(html).toContain('bg-text text-text-inverse focus-visible:outline-text-inverse');
    expect(html).not.toContain('accent');
  });
});

describe('fields', () => {
  it('wraps the input in its label and sets technical values in mono', () => {
    const html = renderToString(<TextField label="Shot" mono defaultValue="4B" />);
    expect(html).toMatch(/^<label[^>]*><span class="sb-label">Shot<\/span><input/);
    expect(html).toContain('font-mono');
    // tokens.test.ts checks this placeholder colour for AA on the oatmeal well.
    expect(html).toContain('placeholder:text-text/70');
  });

  it('gives the slider a readable value, not just an index', () => {
    const html = renderToString(
      <Slider label="T-stop" stops={[1.4, 2, 2.8]} value={2} onChange={() => undefined} format={(t) => `T${t.toFixed(1)}`} />,
    );
    expect(html).toContain('aria-valuetext="T2.0"');
    expect(html).toContain('>T2.0</output>');
  });

  it('exposes the gauge and toggle states', () => {
    expect(renderToString(<BarGauge label="Scene coverage" value={67} />)).toContain('aria-valuenow="67"');
    const toggle = renderToString(<Toggle label="Snap" checked onChange={() => undefined} />);
    expect(toggle).toContain('role="switch"');
    expect(toggle).toContain('aria-checked="true"');
  });
});

describe('tags', () => {
  it('styles every department', () => {
    for (const department of DEPARTMENTS) {
      expect(departmentTagClass(department)).toMatch(/bg-dept-|border/);
    }
  });

  it('edges the camera tag in paper in dark mode, where navy disappears into the panel', () => {
    const classes = departmentTagClass('camera').split(' ');
    expect(classes).toContain('dark:outline');
    expect(classes).toContain('dark:outline-paper-fixed');
  });

  it('uses fixed paper text on the dark department colours', () => {
    for (const department of ['camera', 'sound', 'production'] as const) {
      expect(renderToString(<DepartmentTag department={department} />)).toContain('text-paper-fixed');
    }
  });

  it('names shot status for screen readers, since the shape carries it', () => {
    expect(renderToString(<StatusGlyph status="need" />)).toContain('aria-label="Need to shoot"');
    const labelled = renderToString(<StatusGlyph status="source" showLabel />);
    expect(labelled).toContain('aria-hidden="true"');
    expect(labelled).toContain('>Source</span>');
  });
});

describe('Tile', () => {
  const html = renderToString(
    <Tile
      index={2}
      title="Storyboard"
      tabs={[
        { id: 'sc04', label: 'SC 04' },
        { id: 'sc05', label: 'SC 05' },
      ]}
      activeTab="sc04"
      onToggleMaximize={() => undefined}
      onClose={() => undefined}
    />,
  );

  it('shows the index and title as a mono label', () => {
    expect(html).toContain('02<!-- --> / <!-- -->Storyboard');
    expect(html).toContain('aria-label="Storyboard"');
  });

  it('labels its buttons with the tile they act on', () => {
    expect(html).toContain('aria-label="Maximize Storyboard"');
    expect(html).toContain('aria-label="Close Storyboard"');
  });

  it('marks the open tab with oatmeal, ink and bold, and keeps the strip above the title-bar rule', () => {
    const openTab = /<button[^>]*aria-selected="true"[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
    expect(openTab).toEqual(expect.arrayContaining(['bg-surface-raised', 'font-bold', 'text-text']));
    const tablist = /<div role="tablist"[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
    expect(tablist).toContain('self-stretch');
    expect(tablist).not.toContain('h-titlebar');
  });

  it('links the open tab to the panel', () => {
    expect(count(html, 'role="tab"')).toBe(2);
    const openTabId = /<button[^>]*id="([^"]+)"[^>]*aria-selected="true"/.exec(html)?.[1];
    expect(openTabId).toBeDefined();
    expect(count(html, 'aria-labelledby=')).toBe(1);
    expect(html).toContain(`role="tabpanel" aria-labelledby="${String(openTabId)}"`);
  });
});
