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
}

export interface CanvasItem extends Geometry {
  id: string;
  /** What a person calls it, for the live region: "Rectangle". */
  label: string;
  /** Draws the item in its own box, 0 to width by 0 to height. Without one, a rectangle in the raised surface. */
  draw?: (context: DrawContext) => ReactNode;
}

/** The view: the world point at the middle of the canvas and the zoom (1 is 100%), so it survives a resize. */
export interface Viewport {
  cx: number;
  cy: number;
  zoom: number;
}

export type Tool = 'select' | 'hand' | 'rect';

export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

/** What a key or the context menu asks the host to do to the selection (the host knows its records). */
export type CanvasCommand =
  | { kind: 'copy' }
  | { kind: 'cut' }
  | { kind: 'paste'; at: Point | null }
  | { kind: 'duplicate' }
  | { kind: 'delete' }
  | { kind: ReorderMode };

/** An item's new geometry after a finished gesture. */
export interface GeometryChange extends Geometry {
  id: string;
}
