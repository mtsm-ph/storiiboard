import type { ReactNode } from 'react';

// What the canvas core knows about (decision 11): rectangles in world units and how to draw them. It knows nothing of
// boards or records; src/features/moodboards turns records into these and reports back what a gesture changed.
// World units are abstract: nothing here assumes pixels, so Phase 6's plans can give them a scale in metres.

/** Where an item is: its top-left corner before rotation, its size, and its rotation in degrees, clockwise, round its centre. */
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** A point in world units, or in screen pixels where a name says so. */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The theme's colours as Konva needs them, as real values. */
export interface CanvasColours {
  ink: string;
  paper: string;
  raised: string;
}

export interface DrawContext extends Size {
  colours: CanvasColours;
  /** The view's zoom, so an item can draw more detail up close (a picture's full size). */
  zoom: number;
  /** Whether the item meets the view; one drawn only because it is selected is out of it. */
  inView: boolean;
  /** Drawn for a presentation (5.5): what is only there to be edited on screen (a placeholder) is left out. */
  present?: boolean;
}

export interface CanvasItem extends Geometry {
  id: string;
  /** What a person calls it, for the live region: "Rectangle". */
  label: string;
  /** Draws the item in its own box, 0 to width by 0 to height. Without one, a rectangle in the raised surface. */
  draw?: (context: DrawContext) => ReactNode;
  /** Whether Enter or a double-click edits it in place (text and sticky notes); the host does the editing. */
  editable?: boolean;
  /** Whether Enter or a double-click opens it (a video card in the Player, a link in the browser); the host does it. */
  openable?: boolean;
  /** Resizing keeps its proportions: corner handles only (a picture, a video card). */
  keepRatio?: boolean;
  /** Whether the "+" handles and ⌘⌥ + an arrow make a connected copy of it (5.2: a sticky, a shape, a text box); the host does it. */
  quick?: boolean;
  /**
   * A section (5.3): a frame drawn under the connectors and the other items that holds what lies wholly inside it. It is
   * picked by its name tab or its edge band, never by its middle (a click there starts a marquee), and moves with its
   * contents. It is always upright.
   */
  section?: SectionLook;
}

/** What makes an item a section: the name tab above its top left corner, and how the host draws it. */
export interface SectionLook {
  /** The tab's box relative to the section's top left corner (above it, so negative y); part of the hit area. */
  tab: Rect;
  /** Draws the tab in the section's own coordinates (0, 0 is its top left corner); the host hides the name while it is typed. */
  drawTab?: (context: { colours: CanvasColours; zoom: number }) => ReactNode;
}

/** The view: the world point at the middle of the canvas and the zoom (1 is 100%), so it survives a resize. */
export interface Viewport {
  cx: number;
  cy: number;
  zoom: number;
}

/** The tools that place an item: drag to draw it or click to put one down (5.1a adds text, sticky and three shapes; 5.1b a link card; 5.5 a deck's page). */
export type PlaceTool = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'text' | 'sticky' | 'link' | 'section' | 'page';

/** The Connector tool (5.2) draws a line between items; it places nothing by itself. */
export type Tool = 'select' | 'hand' | 'connector' | PlaceTool;

export const isPlaceTool = (tool: Tool): tool is PlaceTool => tool !== 'select' && tool !== 'hand' && tool !== 'connector';

/** A side of an item's box, before its rotation. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * One end of a connector (5.2): attached to an item at a side (`auto` picks the side facing the other end each time it is
 * drawn), or free at a world point.
 */
export type LinkEnd = { item: string; side: Side | 'auto' } | { x: number; y: number };
export const isAttached = (end: LinkEnd): end is { item: string; side: Side | 'auto' } => 'item' in end;

export type Route = 'straight' | 'elbow' | 'curved';
export type Head = 'none' | 'arrow';

/** A connector as the canvas draws it: its ends, route and look. It has no box of its own; its path is worked out from its ends. */
export interface CanvasLink {
  id: string;
  /** What a person calls it, for the live region: "Connector from Sticky to Rectangle". */
  label: string;
  from: LinkEnd;
  to: LinkEnd;
  route: Route;
  startHead: Head;
  endHead: Head;
  /** `#RRGGBB`, or null for the board's ink. */
  color: string | null;
  /** Line width in world units. */
  width: number;
  /** The words drawn at its middle, on a paper patch; may be empty. */
  text: string;
}

/** A finished drag of a connector: a new one (no `id`) or one end of an existing one moved. */
export interface ConnectDrop {
  id: string | null;
  from: LinkEnd;
  to: LinkEnd;
}

export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

/** Align to the selection's bounds (5.3), distribute along an axis, and tidy into a row, a column or a grid. */
export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';
export type TidyMode = 'row' | 'column' | 'grid';

/** What a key or the context menu asks the host to do to the selection (the host knows its records). */
export type CanvasCommand =
  | { kind: 'copy' }
  | { kind: 'cut' }
  | { kind: 'paste'; at: Point | null }
  | { kind: 'duplicate' }
  | { kind: 'delete' }
  | { kind: ReorderMode }
  | { kind: 'align'; mode: AlignMode }
  | { kind: 'distribute'; axis: Axis }
  | { kind: 'tidy'; mode: TidyMode }
  | { kind: 'sectionAround' };

/** An item's new geometry after a finished gesture. */
export interface GeometryChange extends Geometry {
  id: string;
}
