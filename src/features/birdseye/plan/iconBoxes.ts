// Written by scripts/planIconBoxes.ts (node scripts/planIconBoxes.ts, after the kit’s icons change); never edited by
// hand. What each plan icon draws on its 32 px grid: the bare box of its geometry (no stroke padding), and its shapes
// as data, paths with their transforms applied and texts, in the kit’s own colours. Shared by every item of an icon.

export interface IconBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IconPath {
  kind: 'path';
  d: string;
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  dash: readonly number[] | null;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  opacity: number;
}

export interface IconText {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  anchor: 'start' | 'middle' | 'end';
  family: string;
  weight: number;
  fill: string;
  fillOpacity: number;
  opacity: number;
}

export type IconPart = IconPath | IconText;

export const ICON_BOXES: Readonly<Record<string, IconBox>> = {
  'camera/camera': { x: 9, y: 8, width: 14, height: 16 },
  'camera/dolly-track': { x: 7, y: 3, width: 18, height: 26 },
  'camera/drone': { x: 3.5, y: 3.5, width: 25, height: 25 },
  'camera/field-of-view': { x: 4, y: 5, width: 24, height: 25 },
  'camera/gimbal': { x: 5, y: 6, width: 22, height: 22 },
  'camera/handheld': { x: 9.5, y: 3, width: 13, height: 24.5 },
  'camera/jib-crane': { x: 2.5, y: 3, width: 27.5, height: 25.5 },
  'camera/slider': { x: 3, y: 10, width: 26, height: 12 },
  'camera/steadicam': { x: 5.5, y: 5.5, width: 21, height: 22.5 },
  'camera/sticks': { x: 4, y: 4, width: 24, height: 24 },
  'cast/background': { x: 5, y: 7, width: 22, height: 19 },
  'cast/cast-mark': { x: 6, y: 6, width: 20, height: 20 },
  'cast/eyeline': { x: 3, y: 10, width: 25, height: 12 },
  'cast/next-position': { x: 6, y: 6, width: 20, height: 20 },
  'cast/tape-mark': { x: 8, y: 9, width: 16, height: 15 },
  'cast/walk-path': { x: 3, y: 8, width: 22, height: 21 },
  'grip/apple-box': { x: 6, y: 9, width: 20, height: 14 },
  'grip/bounce': { x: 4, y: 13, width: 24, height: 6 },
  'grip/c-stand': { x: 5, y: 4, width: 24, height: 19 },
  'grip/combo-stand': { x: 5, y: 4, width: 22, height: 22 },
  'grip/diffusion-4x4': { x: 4, y: 11, width: 24, height: 10 },
  'grip/flag': { x: 5, y: 13, width: 22, height: 15 },
  'grip/floppy': { x: 5, y: 10, width: 22, height: 11 },
  'grip/ladder': { x: 10, y: 3, width: 12, height: 26 },
  'grip/neg-fill': { x: 3.85, y: 8.2, width: 24.3, height: 15.6 },
  'grip/overhead-8x8': { x: 3, y: 3, width: 26, height: 26 },
  'grip/rostrum': { x: 4, y: 4, width: 24, height: 24 },
  'grip/sandbag': { x: 6, y: 11, width: 20, height: 10 },
  'lighting/beam-cone': { x: 2, y: 5, width: 26, height: 22 },
  'lighting/china-ball': { x: 5.5, y: 5.5, width: 21, height: 21 },
  'lighting/cob-softbox': { x: 5, y: 5, width: 22, height: 22 },
  'lighting/fresnel': { x: 7, y: 3, width: 18, height: 23.5 },
  'lighting/hmi-par': { x: 3.5, y: 7, width: 24.5, height: 18 },
  'lighting/led-panel': { x: 7, y: 9, width: 18, height: 14 },
  'lighting/practical': { x: 7, y: 7, width: 18, height: 18 },
  'lighting/rgb-gel': { x: 5, y: 5, width: 22, height: 22 },
  'lighting/spacelight': { x: 5, y: 5, width: 22, height: 22 },
  'lighting/sun-path': { x: 1.5, y: 1.5, width: 25.5, height: 25.5 },
  'lighting/tube': { x: 3, y: 14, width: 26, height: 4 },
  'lighting/window-light': { x: 3, y: 9, width: 26, height: 20 },
  'production/basecamp': { x: 4, y: 5, width: 24, height: 21 },
  'production/distro-cable': { x: 3, y: 7, width: 26, height: 16 },
  'production/first-aid': { x: 5, y: 5, width: 22, height: 22 },
  'production/generator': { x: 4, y: 8, width: 24, height: 16 },
  'production/hazard': { x: 5, y: 3, width: 22, height: 20 },
  'production/measure': { x: 4, y: 5.6, width: 24, height: 19.4 },
  'production/north': { x: 9, y: 2, width: 14, height: 30 },
  'production/note': { x: 4, y: 7, width: 24, height: 18 },
  'production/parking': { x: 5, y: 5, width: 22, height: 22 },
  'production/snap-point': { x: 4, y: 4, width: 24, height: 24 },
  'production/video-village': { x: 5, y: 5, width: 22, height: 22 },
  'production/zone': { x: 4, y: 4, width: 24, height: 24 },
  'set-art/bed': { x: 7, y: 3, width: 18, height: 26 },
  'set-art/car': { x: 9, y: 2, width: 14, height: 28 },
  'set-art/chair': { x: 10, y: 8, width: 12, height: 16 },
  'set-art/column': { x: 10, y: 10, width: 12, height: 12 },
  'set-art/counter-bar': { x: 4, y: 5, width: 24, height: 21 },
  'set-art/door': { x: 2, y: 8, width: 28, height: 18 },
  'set-art/plant-tree': { x: 6, y: 6, width: 20, height: 20 },
  'set-art/sofa': { x: 3, y: 8, width: 26, height: 16 },
  'set-art/stairs': { x: 8, y: 3, width: 16, height: 26 },
  'set-art/table': { x: 6, y: 9, width: 20, height: 14 },
  'set-art/wall': { x: 3, y: 16, width: 26, height: 0 },
  'set-art/window': { x: 3, y: 10, width: 26, height: 12 },
  'sound/boom': { x: 2, y: 0.9, width: 27.6, height: 29.1 },
  'sound/lav': { x: 11, y: 6, width: 11, height: 19 },
  'sound/playback': { x: 5, y: 6, width: 22.63, height: 20 },
  'sound/sound-cart': { x: 5, y: 8, width: 22, height: 16 },
};

export const ICON_SHAPES: Readonly<Record<string, readonly IconPart[]>> = {
  'camera/camera': [
    { kind: 'path', d: 'M9 13L23 13L23 24L9 24Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M13 13L11 8L21 8L19 13', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/dolly-track': [
    { kind: 'path', d: 'M7 7L25 7M7 13L25 13M7 19L25 19M7 25L25 25', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.35, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M7 3L7 29M25 3L25 29', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 11L22 11L22 21L10 21Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/drone': [
    { kind: 'path', d: 'M10 10L22 22M22 10L10 22', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12.5 8A4.5 4.5 0 0 1 3.5 8A4.5 4.5 0 0 1 12.5 8Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M28.5 8A4.5 4.5 0 0 1 19.5 8A4.5 4.5 0 0 1 28.5 8Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12.5 24A4.5 4.5 0 0 1 3.5 24A4.5 4.5 0 0 1 12.5 24Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M28.5 24A4.5 4.5 0 0 1 19.5 24A4.5 4.5 0 0 1 28.5 24Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M13 13L19 13L19 19L13 19Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/field-of-view': [
    { kind: 'path', d: 'M16 27L4 7M16 27L28 7', fill: null, fillOpacity: 1, stroke: '#E0612B', strokeOpacity: 1, strokeWidth: 1.5, dash: [3, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M4 7Q16 3 28 7', fill: null, fillOpacity: 1, stroke: '#E0612B', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12.5 25L19.5 25L19.5 30L12.5 30Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/gimbal': [
    { kind: 'path', d: 'M27 17A11 11 0 0 1 5 17A11 11 0 0 1 27 17Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 6L16 9', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M11 13L21 13L21 21L11 21Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/handheld': [
    { kind: 'path', d: 'M22.5 21A6.5 6.5 0 0 1 9.5 21A6.5 6.5 0 0 1 22.5 21Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12 6L20 6L20 14L12 14Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M14 6L13 3L19 3L18 6', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/jib-crane': [
    { kind: 'path', d: 'M6 25L25 8', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 2.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M9.5 25A3.5 3.5 0 0 1 2.5 25A3.5 3.5 0 0 1 9.5 25Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M15.2 19A2.2 2.2 0 0 1 10.8 19A2.2 2.2 0 0 1 15.2 19Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M22 3L30 3L30 10L22 10Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/slider': [
    { kind: 'path', d: 'M3 14L29 14L29 18L3 18Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12 10L20 10L20 22L12 22Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/steadicam': [
    { kind: 'path', d: 'M16 22L16 28M10 28L22 28', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M22 16A6 6 0 0 1 10 16A6 6 0 0 1 22 16Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M26.5 16A10.5 10.5 0 0 1 5.5 16A10.5 10.5 0 0 1 26.5 16Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [2, 2.5], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M13 13L19 13L19 19L13 19Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'camera/sticks': [
    { kind: 'path', d: 'M16 18L4 28M16 18L28 28M16 18L16 4', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M11 12L21 12L21 21L11 21Z', fill: '#1F2F4D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M14 12L13 9L19 9L18 12', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'cast/background': [
    { kind: 'path', d: 'M13 11A4 4 0 0 1 5 11A4 4 0 0 1 13 11Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M27 11A4 4 0 0 1 19 11A4 4 0 0 1 27 11Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M20 22A4 4 0 0 1 12 22A4 4 0 0 1 20 22Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'cast/cast-mark': [
    { kind: 'path', d: 'M26 16A10 10 0 0 1 6 16A10 10 0 0 1 26 16Z', fill: '#E9B8A6', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 2, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'text', text: 'A1', x: 16, y: 20, size: 11, anchor: 'middle', family: 'JetBrains Mono', weight: 700, fill: '#16150F', fillOpacity: 1, opacity: 1 },
  ],
  'cast/eyeline': [
    { kind: 'path', d: 'M15 16A6 6 0 0 1 3 16A6 6 0 0 1 15 16Z', fill: '#E9B8A6', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M15 16L28 16M24 12L28 16L24 20', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'cast/next-position': [
    { kind: 'path', d: 'M26 16A10 10 0 0 1 6 16A10 10 0 0 1 26 16Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [3, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'text', text: 'A2', x: 16, y: 20, size: 11, anchor: 'middle', family: 'JetBrains Mono', weight: 700, fill: '#16150F', fillOpacity: 1, opacity: 1 },
  ],
  'cast/tape-mark': [
    { kind: 'path', d: 'M8 9L24 9M16 9L16 24', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 3.5, dash: null, lineCap: 'butt', lineJoin: 'round', opacity: 1 },
  ],
  'cast/walk-path': [
    { kind: 'path', d: 'M6 26C11 14 20 22 25 8', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [3, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M20 8L25 8L25 13', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M9 26A3 3 0 0 1 3 26A3 3 0 0 1 9 26Z', fill: '#E9B8A6', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/apple-box': [
    { kind: 'path', d: 'M6 9L26 9L26 23L6 23Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 14L14 14L14 18L10 18Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M18 14L22 14L22 18L18 18Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/bounce': [
    { kind: 'path', d: 'M4 13L28 13L28 19L4 19Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M4 16L28 16', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.3, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/c-stand': [
    { kind: 'path', d: 'M16 16L5 22M16 16L19 4M16 16L27 23', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 16L29 11', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 2.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M18.2 16A2.2 2.2 0 0 1 13.8 16A2.2 2.2 0 0 1 18.2 16Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/combo-stand': [
    { kind: 'path', d: 'M5 26L16 6L27 26', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M9 19L23 19', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 2.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M18 6A2 2 0 0 1 14 6A2 2 0 0 1 18 6Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/diffusion-4x4': [
    { kind: 'path', d: 'M4 16L28 16', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 3.5, dash: [3, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M4 11L4 21M28 11L28 21', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/flag': [
    { kind: 'path', d: 'M5 13L27 13L27 17L5 17Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 17L16 25M11 28L21 28', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/floppy': [
    { kind: 'path', d: 'M5 10L27 10L27 14L5 14Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M5 17L27 17L27 21L5 21Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [2, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/ladder': [
    { kind: 'path', d: 'M10 3L10 29M22 3L22 29M10 7L22 7M10 13L22 13M10 19L22 19M10 25L22 25', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/neg-fill': [
    { kind: 'path', d: 'M3.8565 18.3525L25.6078 8.2097L28.1435 13.6475L6.3922 23.7903Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/overhead-8x8': [
    { kind: 'path', d: 'M5 5L27 5L27 27L5 27Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [4, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M7 5A2 2 0 0 1 3 5A2 2 0 0 1 7 5Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M29 5A2 2 0 0 1 25 5A2 2 0 0 1 29 5Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M7 27A2 2 0 0 1 3 27A2 2 0 0 1 7 27Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M29 27A2 2 0 0 1 25 27A2 2 0 0 1 29 27Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/rostrum': [
    { kind: 'path', d: 'M4 4L28 4L28 28L4 28Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M4 4L28 28M28 4L4 28', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.5, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'grip/sandbag': [
    { kind: 'path', d: 'M11 11L21 11A5 5 0 0 1 26 16L26 16A5 5 0 0 1 21 21L11 21A5 5 0 0 1 6 16L6 16A5 5 0 0 1 11 11Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 11L16 21', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/beam-cone': [
    { kind: 'path', d: 'M10 16A4 4 0 0 1 2 16A4 4 0 0 1 10 16Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 13L28 5M10 19L28 27', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M28 5L28 27', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [2, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/china-ball': [
    { kind: 'path', d: 'M26.5 16A10.5 10.5 0 0 1 5.5 16A10.5 10.5 0 0 1 26.5 16Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M7 12L25 12M6 16L26 16M7 20L25 20', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.45, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/cob-softbox': [
    { kind: 'path', d: 'M12 5L20 5L27 12L27 20L20 27L12 27L5 20L5 12Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M18.2 16A2.2 2.2 0 0 1 13.8 16A2.2 2.2 0 0 1 18.2 16Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/fresnel': [
    { kind: 'path', d: 'M23.5 19A7.5 7.5 0 0 1 8.5 19A7.5 7.5 0 0 1 23.5 19Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M19.5 19A3.5 3.5 0 0 1 12.5 19A3.5 3.5 0 0 1 19.5 19Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M9 9L7 5M16 8L16 3M23 9L25 5', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/hmi-par': [
    { kind: 'path', d: 'M14.5 16A5.5 5.5 0 0 1 3.5 16A5.5 5.5 0 0 1 14.5 16Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M14.5 13L28 7L28 25L14.5 19', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [2, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/led-panel': [
    { kind: 'path', d: 'M7 9L25 9L25 23L7 23Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M13 9L13 23M19 9L19 23M7 16L25 16', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.5, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/practical': [
    { kind: 'path', d: 'M25 16A9 9 0 0 1 7 16A9 9 0 0 1 25 16Z', fill: '#FFB162', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M18.5 16A2.5 2.5 0 0 1 13.5 16A2.5 2.5 0 0 1 18.5 16Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/rgb-gel': [
    { kind: 'path', d: 'M5 5L14 5L14 27L5 27Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M18 5L27 5L27 27L18 27Z', fill: '#E0612B', fillOpacity: 0.25, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M14 9L18 9M14 16L18 16M14 23L18 23', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.5, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/spacelight': [
    { kind: 'path', d: 'M27 16A11 11 0 0 1 5 16A11 11 0 0 1 27 16Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [3, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 11L16 21M11 16L21 16', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/sun-path': [
    { kind: 'path', d: 'M14 9A5 5 0 0 1 4 9A5 5 0 0 1 14 9Z', fill: '#FFB162', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M9 1.5L9 3.5M9 14.5L9 16.5M1.5 9L3.5 9M14.5 9L16.5 9', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M14 14L27 27M27 20L27 27L20 27', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/tube': [
    { kind: 'path', d: 'M5 14L27 14A2 2 0 0 1 29 16L29 16A2 2 0 0 1 27 18L5 18A2 2 0 0 1 3 16L3 16A2 2 0 0 1 5 14Z', fill: '#D9A23D', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'lighting/window-light': [
    { kind: 'path', d: 'M3 9L29 9M3 23L29 23', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 3, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M3 12L29 12M3 20L29 20', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.5, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M8 23L4 29M16 23L16 29M24 23L28 29', fill: null, fillOpacity: 1, stroke: '#D9A23D', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/basecamp': [
    { kind: 'path', d: 'M4 26L16 5L28 26Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 5L16 26', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/distro-cable': [
    { kind: 'path', d: 'M3 12L12 12L12 21L3 21Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12 16C17 16 17 7 22 7C27 7 24 23 29 23', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [3, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/first-aid': [
    { kind: 'path', d: 'M5 5L27 5L27 27L5 27Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 10L16 22M10 16L22 16', fill: null, fillOpacity: 1, stroke: '#A35139', strokeOpacity: 1, strokeWidth: 3.5, dash: null, lineCap: 'butt', lineJoin: 'round', opacity: 1 },
  ],
  'production/generator': [
    { kind: 'path', d: 'M4 8L28 8L28 24L4 24Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M17 11L13 17L19 17L15 23', fill: null, fillOpacity: 1, stroke: '#E0612B', strokeOpacity: 1, strokeWidth: 1.8, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/hazard': [
    { kind: 'path', d: 'M16 3L27 23L5 23Z', fill: null, fillOpacity: 1, stroke: '#A35139', strokeOpacity: 1, strokeWidth: 2, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 11L16 17M16 20L16 21', fill: null, fillOpacity: 1, stroke: '#A35139', strokeOpacity: 1, strokeWidth: 2, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/measure': [
    { kind: 'path', d: 'M4 21L28 21M4 17L4 25M28 17L28 25', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 21L10 18M16 21L16 17M22 21L22 18', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'text', text: '2.4M', x: 16, y: 12, size: 8, anchor: 'middle', family: 'JetBrains Mono', weight: 700, fill: '#16150F', fillOpacity: 1, opacity: 1 },
  ],
  'production/north': [
    { kind: 'path', d: 'M16 2L23 25L16 20L9 25Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'text', text: 'N', x: 16, y: 31, size: 7, anchor: 'middle', family: 'JetBrains Mono', weight: 700, fill: '#16150F', fillOpacity: 1, opacity: 1 },
  ],
  'production/note': [
    { kind: 'path', d: 'M4 7L28 7L28 25L4 25Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M8 12L24 12M8 16L24 16M8 20L18 20', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.6, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/parking': [
    { kind: 'path', d: 'M5 5L27 5L27 27L5 27Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'text', text: 'P', x: 16, y: 21, size: 13, anchor: 'middle', family: 'JetBrains Mono', weight: 700, fill: '#16150F', fillOpacity: 1, opacity: 1 },
  ],
  'production/snap-point': [
    { kind: 'path', d: 'M4 16L28 16M16 4L16 28', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.5, strokeWidth: 1.5, dash: [2, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M25 16A9 9 0 0 1 7 16A9 9 0 0 1 25 16Z', fill: null, fillOpacity: 1, stroke: '#E0612B', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 7L16 4M16 28L16 25M7 16L4 16M28 16L25 16', fill: null, fillOpacity: 1, stroke: '#E0612B', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/video-village': [
    { kind: 'path', d: 'M5 5L27 5L27 19L5 19Z', fill: '#C9C1B1', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 19L16 24M10 27L22 27', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'production/zone': [
    { kind: 'path', d: 'M4 4L28 4L28 28L4 28Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [3, 3], lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M4 4L10 4M4 4L4 10', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/bed': [
    { kind: 'path', d: 'M7 3L25 3L25 29L7 29Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M9 5L15 5L15 9L9 9Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M17 5L23 5L23 9L17 9Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M7 12L25 12', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/car': [
    { kind: 'path', d: 'M13 2L19 2A4 4 0 0 1 23 6L23 26A4 4 0 0 1 19 30L13 30A4 4 0 0 1 9 26L9 6A4 4 0 0 1 13 2Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M11 8L21 8L21 13L11 13Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M11 21L21 21L21 25L11 25Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/chair': [
    { kind: 'path', d: 'M10 12L22 12L22 24L10 24Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 8L22 8', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 3, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/column': [
    { kind: 'path', d: 'M10 10L22 10L22 22L10 22Z', fill: '#16150F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/counter-bar': [
    { kind: 'path', d: 'M4 5L12 5L12 19L28 19L28 26L4 26Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/door': [
    { kind: 'path', d: 'M2 26L10 26M28 26L30 26', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 4, dash: null, lineCap: 'butt', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 26L10 8', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M10 8A18 18 0 0 1 28 26', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: [2, 2], lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/plant-tree': [
    { kind: 'path', d: 'M26 16A10 10 0 0 1 6 16A10 10 0 0 1 26 16Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 6L16 26M6 16L26 16M9 9L23 23M23 9L9 23', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.5, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/sofa': [
    { kind: 'path', d: 'M3 12L29 12L29 24L3 24Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M3 8L29 8', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 3, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M12 12L12 24M20 12L20 24', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.45, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/stairs': [
    { kind: 'path', d: 'M8 3L24 3L24 29L8 29Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M8 8L24 8M8 13L24 13M8 18L24 18M8 23L24 23', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 26L16 6M13 9L16 6L19 9', fill: null, fillOpacity: 1, stroke: '#E0612B', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/table': [
    { kind: 'path', d: 'M6 9L26 9L26 23L6 23Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/wall': [
    { kind: 'path', d: 'M3 16L29 16', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 5, dash: null, lineCap: 'butt', lineJoin: 'round', opacity: 1 },
  ],
  'set-art/window': [
    { kind: 'path', d: 'M3 12L29 12M3 20L29 20', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M3 16L29 16', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 0.45, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M3 10L3 22M29 10L29 22', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 3, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'sound/boom': [
    { kind: 'path', d: 'M5 27L23 9', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 2, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M23.9393 0.9038L29.5962 6.5607L26.0607 10.0962L20.4038 4.4393Z', fill: '#A8482F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M8 27A3 3 0 0 1 2 27A3 3 0 0 1 8 27Z', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'sound/lav': [
    { kind: 'path', d: 'M21 11A5 5 0 0 1 11 11A5 5 0 0 1 21 11Z', fill: '#A8482F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M16 16L16 22C16 26 22 26 22 22L22 20', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'sound/playback': [
    { kind: 'path', d: 'M5 12L10 12L17 6L17 26L10 20L5 20Z', fill: '#A8482F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M21 11C23 14 23 18 21 21M25 8C28.5 13 28.5 19 25 24', fill: null, fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
  'sound/sound-cart': [
    { kind: 'path', d: 'M5 8L27 8L27 24L5 24Z', fill: '#A8482F', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M14.5 16A3 3 0 0 1 8.5 16A3 3 0 0 1 14.5 16Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
    { kind: 'path', d: 'M23.5 16A3 3 0 0 1 17.5 16A3 3 0 0 1 23.5 16Z', fill: '#FFFFFF', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 },
  ],
};
