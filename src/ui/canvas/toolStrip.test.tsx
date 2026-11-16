import { renderToString } from 'react-dom/server';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PLAN_TOOLS, WALL_TOOL } from '../../features/birdseye/plan/planScale';
import { hostToolForKey, toolForKey, type KeyLike } from './keys';
import { fitViewOf } from './hitTest';
import { leftClearOf, STRIP_GAP } from './stripClear';
import { boardStripTools, hostStripTools, STRIP_INSET, type StripTool } from './stripTools';
import { fitBeside, fitBounds, firstViewBeside, middleBeside, toScreen } from './viewport';
import { stripRows, tipText, ToolButton, ToolStrip } from './ToolStrip';

// The tools' strip (6.5.2): the tools it is given, the one pressed, a press picking its tool, the keys it shows and the
// keys that pick: V, H and now Shift+H for the hand.

const key = (k: string, rest: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...rest });

const count = (html: string, needle: string) => html.split(needle).length - 1;

type Pressable = ReactElement<{ onClick?: () => void; children?: ReactNode }>;

/** Presses the <button> in what a hook-free component returned, as a click would. */
function press(node: ReactNode): void {
  const find = (at: ReactNode): Pressable | null => {
    if (!isValidElement(at)) return null;
    const element = at as Pressable;
    if (element.type === 'button') return element;
    for (const child of Children.toArray(element.props.children)) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const button = find(node);
  if (!button?.props.onClick) throw new Error('no button');
  button.props.onClick();
}

describe('the tool strip', () => {
  it('shows the tools it is given, in order, each named, with its keys, and only the active one pressed', () => {
    const html = renderToString(<ToolStrip tools={hostStripTools(PLAN_TOOLS, WALL_TOOL, () => undefined)} />);
    expect(html).toContain('aria-label="Tools"');
    expect(count(html, '<button')).toBe(PLAN_TOOLS.length);
    const names = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Select', 'Hand', 'Wall', 'Door', 'Window', 'Camera', 'Light', 'Mark', 'Measure']);
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toMatch(/aria-label="Wall" aria-pressed="true" aria-keyshortcuts="W"/);
    expect(html).toMatch(/aria-label="Hand" aria-pressed="false" aria-keyshortcuts="H Shift\+H"/);
    // The icons are inline and drawn in the button's colour, so the pressed one turns inverse on its ink fill.
    expect(count(html, '<svg ')).toBe(PLAN_TOOLS.length);
    expect(html).toContain('stroke="currentColor"');
    // Selection is an ink fill, never the accent.
    expect(html).not.toContain('accent');
    expect(html).toContain('bg-text text-text-inverse');
    // No tooltip until hover or keyboard focus.
    expect(html).not.toContain('data-tool-tip');
  });

  it('gives a board its tools, Shapes, and on a deck the Page tool', () => {
    const ids = (tools: StripTool[]) => tools.map((tool) => tool.id);
    expect(ids(boardStripTools('select', () => undefined, false))).toEqual(['select', 'hand', 'rect', 'text', 'sticky', 'link', 'connector', 'section', 'shapes']);
    expect(ids(boardStripTools('select', () => undefined, true))).toEqual(['select', 'hand', 'rect', 'text', 'sticky', 'link', 'connector', 'section', 'page', 'shapes']);
    // Shapes is pressed for the three shapes only it offers; the rectangle has its own button.
    const shapes = (tool: Parameters<typeof boardStripTools>[0]) => boardStripTools(tool, () => undefined, false).find((t) => t.id === 'shapes');
    expect(shapes('ellipse')?.active).toBe(true);
    expect(shapes('rect')?.active).toBe(false);
    expect(shapes('rect')?.options?.map((o) => o.id)).toEqual(['rect', 'ellipse', 'triangle', 'diamond']);
    const html = renderToString(<ToolStrip tools={boardStripTools('rect', () => undefined, false)} />);
    expect(html).toMatch(/aria-label="Shapes" aria-pressed="false" aria-keyshortcuts="O" aria-expanded="false"/);
    expect(html).toMatch(/aria-label="Section" aria-pressed="false" aria-keyshortcuts="Shift\+S"/);
  });

  it('picks its tool when pressed, and a tool of several opens its options instead', () => {
    const onTool = vi.fn();
    const [, hand] = hostStripTools(PLAN_TOOLS, 'select', onTool);
    if (!hand) throw new Error('no hand');
    press(ToolButton({ tool: hand, tip: false, onTip: () => undefined }));
    expect(onTool).toHaveBeenCalledWith('hand');
    const onBoard = vi.fn();
    const onToggle = vi.fn();
    const shapes = boardStripTools('select', onBoard, false).find((t) => t.id === 'shapes');
    if (!shapes) throw new Error('no shapes');
    press(ToolButton({ tool: shapes, tip: false, onTip: () => undefined, onToggle }));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onBoard).not.toHaveBeenCalled();
    shapes.options?.[2]?.onSelect();
    expect(onBoard).toHaveBeenCalledWith('triangle');
  });

  it('says "Name (Key)" in its tooltip, shown on demand', () => {
    const tools = hostStripTools(PLAN_TOOLS, 'select', () => undefined);
    expect(tools.map(tipText)).toEqual(['Select (V)', 'Hand (H, ⇧H)', 'Wall (W)', 'Door (D)', 'Window (N)', 'Camera (C)', 'Light (L)', 'Mark (M)', 'Measure (R)']);
    expect(tipText({ name: 'Set scale', keys: '' })).toBe('Set scale');
    const [select] = tools;
    if (!select) throw new Error('no select');
    expect(renderToString(<ToolButton tool={select} tip onTip={() => undefined} />)).toMatch(/data-tool-tip=""[^>]*>Select \(V\)<\/span>/);
  });

  it('wraps into another column when the canvas is too short, never under the zoom’s boxes', () => {
    expect(stripRows(900, 9)).toBe(9);
    // 240 px (the canvas's least height): 8 above, 85 kept at the foot, 3 of rules, 4 of padding, 28 a button.
    expect(stripRows(240, 9)).toBe(5);
    expect(stripRows(40, 9)).toBe(1);
  });

  it('fits beside the strip, and places from the keyboard in the middle of what is seen (round 2)', () => {
    const size = { width: 851, height: 600 };
    const bounds = { x: -100, y: -50, width: 200, height: 100 };
    // The bounds' middle lands in the middle of the canvas right of the strip: (51 + 851) / 2 = 451 px.
    const view = fitBeside(bounds, size, STRIP_INSET);
    expect(STRIP_INSET).toBe(51);
    expect(toScreen(view, size, { x: 0, y: 0 }).x).toBeCloseTo(451, 6);
    expect(toScreen(view, size, { x: -100, y: 0 }).x).toBeGreaterThan(STRIP_INSET);
    // No strip: the plain fit.
    expect(fitBeside(bounds, size, 0)).toEqual(fitBounds(bounds, size));
    // Fit all with the strip: 200 × 100 into 800 × 600 less 48 px a side fits at 100% (the fit's most), its middle at
    // 451 px, so cx is 0 − 25.5.
    expect(fitViewOf([{ ...bounds, rotation: 0 }], size, { min: 0.1, max: 8, fitMax: 1 }, STRIP_INSET)).toEqual({ zoom: 1, cx: -25.5, cy: 0 });
    // A wide item zooms out: 1408 wide into 800 − 96 = 704 px is 50%, and the middle then sits 51 px of world left.
    expect(fitViewOf([{ x: -704, y: 0, width: 1408, height: 10, rotation: 0 }], size, { min: 0.1, max: 8, fitMax: 1 }, STRIP_INSET)).toEqual({ zoom: 0.5, cx: -51, cy: 5 });
    // A size not measured yet: the default view, as fitBounds.
    expect(fitBeside(bounds, { width: 0, height: 600 }, STRIP_INSET)).toEqual({ cx: 0, cy: 0, zoom: 1 });
    expect(fitBeside(bounds, { width: 851, height: 0 }, STRIP_INSET)).toEqual({ cx: 0, cy: 0, zoom: 1 });
    // The first view puts the origin in the middle of what is seen, which is where the keyboard places.
    const first = firstViewBeside(STRIP_INSET);
    expect(toScreen(first, size, { x: 0, y: 0 }).x).toBe(451);
    expect(middleBeside(first, STRIP_INSET)).toEqual({ x: 0, y: 0 });
    expect(middleBeside({ cx: 10, cy: 5, zoom: 2 }, STRIP_INSET)).toEqual({ x: 22.75, y: 5 });
  });

  it('moves a panel that would cover the strip to its right, as far as needed (round 2)', () => {
    const strip = { left: 8, top: 100, right: 43, bottom: 400 };
    expect(leftClearOf({ left: 20, top: 90, right: 244, bottom: 300 }, [strip])).toBe(43 + STRIP_GAP);
    // Clear already: below it, or right of it.
    expect(leftClearOf({ left: 20, top: 410, right: 244, bottom: 600 }, [strip])).toBe(20);
    expect(leftClearOf({ left: 60, top: 90, right: 284, bottom: 300 }, [strip])).toBe(60);
    // Nearer than the gap: moved to it.
    expect(leftClearOf({ left: 46, top: 90, right: 270, bottom: 300 }, [strip])).toBe(51);
  });

  it('picks the hand with Shift+H as with H, on a board and on a plan, and leaves the other letters as they were', () => {
    expect(toolForKey(key('H', { shiftKey: true }))).toBe('hand');
    expect(toolForKey(key('h'))).toBe('hand');
    expect(toolForKey(key('v'))).toBe('select');
    expect(hostToolForKey(key('H', { shiftKey: true }), PLAN_TOOLS)).toBe('hand');
    expect(hostToolForKey(key('h'), PLAN_TOOLS)).toBe('hand');
    expect(hostToolForKey(key('v'), PLAN_TOOLS)).toBe('select');
    expect(hostToolForKey(key('H', { shiftKey: true, ctrlKey: true }), PLAN_TOOLS)).toBeNull();
    // A host without the hand has no Shift+H.
    expect(hostToolForKey(key('H', { shiftKey: true }), PLAN_TOOLS.filter((spec) => spec.id !== 'hand'))).toBeNull();
    expect(hostToolForKey(key('W', { shiftKey: true }), PLAN_TOOLS)).toBeNull();
  });
});
