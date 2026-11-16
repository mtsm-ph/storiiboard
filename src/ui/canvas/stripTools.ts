import { t } from '../../core/i18n';
import { toolIconName } from './toolIcons/toolIcons';
import type { Tool, ToolSpec } from './types';

// What each host puts in the tool strip (6.5.2): a board's tools from the core's own letters, a host's (a plan's) from
// its ToolSpec list, both in the order they had as a row of labelled buttons, Select and Hand first.

/**
 * The screen pixels the strip takes along the canvas's left edge, as a host tells its canvas (6.5.2 round 2): its 8 px
 * off the edge, one 28 px column with its two 1.5 px rules and 2 px of padding a side, and a gap of 8 px. A strip
 * wrapped into a second column (a very short canvas) is wider; fitting there counts one column.
 */
export const STRIP_INSET = 8 + 28 + 3 + 4 + 8;

/** A tool of several, offered from one button (a board's Shapes): pressing one picks it. */
export interface StripOption {
  id: string;
  name: string;
  icon: string;
  onSelect: () => void;
}

/** One button of the strip. */
export interface StripTool {
  id: string;
  /** Its accessible name and the tooltip's words. */
  name: string;
  /** The keys as the tooltip shows them ("V", "⇧S"); empty when no key picks it. */
  keys: string;
  /** The keys as `aria-keyshortcuts` says them ("Shift+S"), when not the same as shown. */
  aria?: string;
  /** Its icon's file in toolIcons/, without .svg. */
  icon: string;
  active: boolean;
  /** Picks the tool; left out when the button opens `options` instead. */
  onSelect?: () => void;
  options?: readonly StripOption[];
}

/** A board's tools with their letters (toolForKey in keys.ts reads the same letters). */
export const BOARD_TOOLS: readonly { id: Tool; key: string; aria?: string; label: () => string }[] = [
  { id: 'select', key: 'V', label: () => t('canvas.tool.select') },
  { id: 'hand', key: 'H', label: () => t('canvas.tool.hand') },
  { id: 'rect', key: 'R', label: () => t('canvas.tool.rect') },
  { id: 'text', key: 'T', label: () => t('canvas.tool.text') },
  { id: 'sticky', key: 'S', label: () => t('canvas.tool.sticky') },
  { id: 'link', key: 'L', label: () => t('canvas.tool.link') },
  { id: 'connector', key: 'C', label: () => t('canvas.tool.connector') },
  { id: 'section', key: '⇧S', aria: 'Shift+S', label: () => t('canvas.tool.section') },
];

/** The Shapes button (O draws an ellipse) and the four shapes it opens. */
export const SHAPES_BUTTON = { id: 'shapes', key: 'O', label: () => t('canvas.tool.shapes') } as const;
export const SHAPE_TOOLS: readonly { id: Tool; label: () => string }[] = [
  { id: 'rect', label: () => t('canvas.tool.rect') },
  { id: 'ellipse', label: () => t('canvas.tool.ellipse') },
  { id: 'triangle', label: () => t('canvas.tool.triangle') },
  { id: 'diamond', label: () => t('canvas.tool.diamond') },
];
/** The shapes that press the Shapes button (the rectangle has its own). */
const SHAPES_PRESSED: readonly Tool[] = ['ellipse', 'triangle', 'diamond'];

/** A deck's board adds the Page tool (5.5). */
export const PAGE_TOOL = { id: 'page' as Tool, key: 'P', label: () => t('canvas.tool.page') };

/**
 * The hand is picked by H and by Shift+H: on a board Shift+H always did (toolForKey reads the letter whatever Shift
 * says); on a plan it is new in 6.5.2. Holding Space pans as well, without changing the tool.
 */
const HAND_KEYS = { keys: 'H, ⇧H', aria: 'H Shift+H' } as const;

const keysOf = (id: Tool, key: string, aria: string | undefined): { keys: string; aria?: string } =>
  id === 'hand' ? HAND_KEYS : { keys: key, ...(aria ? { aria } : {}) };

/** A board's strip: its tools, on a deck the Page tool, then Shapes, as the row had them. */
export function boardStripTools(tool: Tool, onTool: (tool: Tool) => void, pages: boolean): StripTool[] {
  const plain = (spec: { id: Tool; key: string; aria?: string; label: () => string }): StripTool => ({
    id: spec.id,
    name: spec.label(),
    ...keysOf(spec.id, spec.key, spec.aria),
    icon: toolIconName(spec.id),
    active: spec.id === tool,
    onSelect: () => {
      onTool(spec.id);
    },
  });
  const shapes: StripTool = {
    id: SHAPES_BUTTON.id,
    name: SHAPES_BUTTON.label(),
    keys: SHAPES_BUTTON.key,
    icon: SHAPES_BUTTON.id,
    active: SHAPES_PRESSED.includes(tool),
    options: SHAPE_TOOLS.map((shape) => ({
      id: shape.id,
      name: shape.label(),
      icon: toolIconName(shape.id),
      onSelect: () => {
        onTool(shape.id);
      },
    })),
  };
  // A deck's Page comes before Shapes, as in the row it had (5.5).
  return [...BOARD_TOOLS.map(plain), ...(pages ? [plain(PAGE_TOOL)] : []), shapes];
}

/** A host's own strip (6.2a: a plan's), from the tools it gives the canvas. */
export function hostStripTools(specs: readonly ToolSpec[], tool: Tool, onTool: (tool: Tool) => void): StripTool[] {
  return specs.map((spec) => ({
    id: spec.id,
    name: spec.label(),
    ...keysOf(spec.id, spec.key, spec.aria),
    icon: toolIconName(spec.id),
    active: spec.id === tool,
    onSelect: () => {
      onTool(spec.id);
    },
  }));
}
