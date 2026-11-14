import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { IconFields } from '../../../core/model/plan';
import { PLAN_ICONS, type PlanIcon } from '../../../ui/icons/plan/planIcons';
import { IconShape, iconContentBox, iconFit, iconNodes, iconShapesOf, paintOf, UnknownIconShape } from './iconDraw';
import { ICON_BOXES, ICON_SHAPES } from './iconBoxes';
import { cameraItem, iconItem } from './planItems';

// How a plan icon is drawn (third review round): as vectors from the committed table, one Konva Path a shape with
// non-scaling strokes in the kit's hex, inside one Group mapping the ink's box to the item's; an icon's nodes made once
// and shared by every item, so 300 items make no copies of its shape data; an id the table lacks draws the "?" outline.
// (The raster cache it replaced, and its tests, are gone.)

const iconOf = (id: string): PlanIcon => {
  const icon = PLAN_ICONS.find((i) => i.id === id);
  if (!icon) throw new Error(id);
  return icon;
};

type Props = Record<string, unknown>;
const propsOf = (node: ReactNode): Props => (isValidElement(node) ? (node.props as Props) : {});
/** A function component's element rendered one level, as React would (no hooks in these). */
const renderOnce = (node: ReactNode): ReactNode => {
  if (!isValidElement(node) || typeof node.type !== 'function') return node;
  return (node.type as (p: Props) => ReactNode)(node.props as Props);
};
const childrenOf = (node: ReactNode): ReactNode[] => {
  const kids = propsOf(node).children as ReactNode;
  return Array.isArray(kids) ? (kids as ReactNode[]) : kids === undefined ? [] : [kids];
};
const context = { zoom: 0.5, colours: { ink: '#16150F', paper: '#EEE9DF', raised: '#C9C1B1' }, inView: true, width: 0, height: 0 };

describe('an icon’s shapes and box', () => {
  it('come from the committed table, the box of the ink with no stroke padding', () => {
    const sofa = iconOf('set-art/sofa');
    expect(iconContentBox(sofa)).toEqual(ICON_BOXES['set-art/sofa']);
    expect(iconContentBox(sofa)).toEqual({ x: 3, y: 8, width: 26, height: 16 });
    expect(iconShapesOf('set-art/sofa')).toBe(ICON_SHAPES['set-art/sofa']);
    expect(iconShapesOf('set-art/hovercraft')).toBeNull();
  });

  it('map the ink’s box onto the item’s, stretched; a line with no depth keeps its scale, in the middle', () => {
    // The sofa's 26 by 16 ink onto a 200 by 90 item.
    const fit = iconFit({ x: 3, y: 8, width: 26, height: 16 }, 200, 90);
    expect(fit.scaleX).toBeCloseTo(200 / 26, 9);
    expect(fit.scaleY).toBeCloseTo(90 / 16, 9);
    expect(fit.x).toBeCloseTo(-3 * (200 / 26), 9);
    expect(fit.y).toBeCloseTo(-8 * (90 / 16), 9);
    // The wall's bar, 26 wide and no deeper than a line, onto 260 by 10: scale 10 both ways, on the item's middle.
    expect(iconFit({ x: 3, y: 16, width: 26, height: 0 }, 260, 10)).toEqual({ x: -30, y: 5 - 160, scaleX: 10, scaleY: 10 });
  });

  it('keep the kit’s hex, an opacity under 1 as rgba of the same colour', () => {
    expect(paintOf('#16150F', 1)).toBe('#16150F');
    expect(paintOf('#16150F', 0.45)).toBe('rgba(22, 21, 15, 0.45)');
    expect(paintOf('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });
});

describe('the nodes an icon is drawn with', () => {
  it('are one Path a shape, lines at the kit’s weight in screen pixels, dashes as the kit’s, never listening', () => {
    const nodes = iconNodes('production/zone') ?? [];
    expect(nodes).toHaveLength(2);
    const [outline, corner] = nodes.map(propsOf);
    expect(outline).toMatchObject({ data: 'M4 4L28 4L28 28L4 28Z', stroke: '#16150F', strokeWidth: 1.5, strokeScaleEnabled: false, dash: [3, 3], lineCap: 'round', lineJoin: 'round', perfectDrawEnabled: false, listening: false });
    // No fill in the kit: none drawn.
    expect(outline).not.toHaveProperty('fill');
    expect(corner).not.toHaveProperty('dash');
    // The sofa's seat in the kit's green, its seams at 45%.
    const sofa = (iconNodes('set-art/sofa') ?? []).map(propsOf);
    expect(sofa[0]).toMatchObject({ fill: '#8FA38E', stroke: '#16150F' });
    expect(sofa[1]).toMatchObject({ strokeWidth: 3 });
    expect(sofa[2]).toMatchObject({ stroke: 'rgba(22, 21, 15, 0.45)' });
  });

  it('set a text from its own shape, in the bundled face', () => {
    const [, letter] = iconNodes('production/parking') ?? [];
    expect(propsOf(letter).part).toBe(ICON_SHAPES['production/parking']?.[1]);
    expect(propsOf(letter).part).toMatchObject({ text: 'P', family: 'JetBrains Mono', weight: 700 });
  });

  it('draw an icon the table doesn’t have as the “?” outline', () => {
    const odd: PlanIcon = { id: 'set-art/hovercraft', group: 'set-art', label: 'Hovercraft', svg: '<svg/>' };
    const drawn = renderOnce(createElement(IconShape, { icon: odd, width: 10, height: 10, zoom: 1, name: '', colours: context.colours }));
    expect(isValidElement(drawn) && drawn.type).toBe(UnknownIconShape);
  });
});

describe('300 icon items', () => {
  const ids = ['set-art/sofa', 'set-art/table', 'grip/c-stand', 'production/parking', 'production/basecamp', 'sound/boom'];
  const fields = (id: string, i: number): IconFields => ({ kind: 'icon', icon: id, x: i, y: i, width: 1 + (i % 3), height: 0.5 + (i % 2), rotation: 0, heightM: null, name: '' });

  it('share each icon’s nodes and shape data, making no copies per item', () => {
    const groups: ReactElement[] = [];
    for (let i = 0; i < 300; i += 1) {
      const id = ids[i % ids.length] ?? '';
      const item = i % 50 === 0 ? cameraItem(`c${String(i)}`, { ...fields('camera/sticks', i), kind: 'camera', icon: 'camera/sticks', bodyId: null, shotIds: [], shownShotId: null, lensMm: null, lensId: null, onSide: false }, 'metres', { degrees: null, lines: [], selected: false }) : iconItem(`i${String(i)}`, fields(id, i), 'metres');
      const shape = renderOnce(item.draw?.(context));
      const group = renderOnce(childrenOf(shape)[0]);
      expect(isValidElement(group)).toBe(true);
      groups.push(group as ReactElement);
    }
    const byIcon = new Map<readonly ReactElement[], number>();
    for (const group of groups) {
      const kids = (group.props as Props).children as readonly ReactElement[];
      byIcon.set(kids, (byIcon.get(kids) ?? 0) + 1);
    }
    // One node array an icon, the very one iconNodes keeps: 6 icons and the camera's sticks.
    expect(byIcon.size).toBe(7);
    for (const id of [...ids, 'camera/sticks']) expect(byIcon.has(iconNodes(id) ?? [])).toBe(true);
    // And each node's data is the table's own: a text node holds the table's shape object, not a copy.
    for (const id of ids) {
      const shapes = ICON_SHAPES[id] ?? [];
      (iconNodes(id) ?? []).forEach((node, i) => {
        const shape = shapes[i];
        if (shape?.kind === 'text') expect(propsOf(node).part).toBe(shape);
        else expect(propsOf(node).data).toBe(shape?.d);
      });
    }
  });
});
