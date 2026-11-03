// Colour arithmetic for project themes (1.14): sRGB, OKLab and OKLCH (Björn Ottosson's), and WCAG contrast. OKLab
// is used because equal steps in it look equal, so clusters, distances and lightness moves behave as the eye expects.

/** sRGB, 0 to 255 each. */
export type Rgb = readonly [number, number, number];
/** OKLab: lightness 0 to 1, then a (green to red) and b (blue to yellow), roughly -0.4 to 0.4. */
export type Lab = readonly [number, number, number];
/** OKLCH: lightness 0 to 1, chroma from 0 (grey) to about 0.37, hue in degrees. */
export interface Lch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToLab([r, g, b]: Rgb): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** sRGB for an OKLab colour, unclamped: a channel outside 0 to 255 means it's out of gamut. */
function labToRgbRaw([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function inGamut(lab: Lab): boolean {
  return labToRgbRaw(lab).every((c) => c >= -0.5 && c <= 255.5);
}

export function labToRgb(lab: Lab): Rgb {
  const [r, g, b] = labToRgbRaw(lab).map((c) => Math.round(Math.min(255, Math.max(0, c))));
  return [r ?? 0, g ?? 0, b ?? 0];
}

export function labToLch([l, a, b]: Lab): Lch {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

export function lchToLab({ l, c, h }: Lch): Lab {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

/** The most chroma at this lightness and hue that sRGB can show, up to `c`. */
export function fitChroma(lch: Lch): Lch {
  if (inGamut(lchToLab(lch))) return lch;
  let low = 0;
  let high = lch.c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(lchToLab({ ...lch, c: mid }))) low = mid;
    else high = mid;
  }
  return { ...lch, c: low };
}

export const lchToRgb = (lch: Lch): Rgb => labToRgb(lchToLab(fitChroma(lch)));
export const rgbToLch = (rgb: Rgb): Lch => labToLch(rgbToLab(rgb));

export function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function parseHex(text: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text.trim());
  if (!m) throw new Error(`Not a colour: ${text}`);
  return [parseInt(m[1] ?? '0', 16), parseInt(m[2] ?? '0', 16), parseInt(m[3] ?? '0', 16)];
}

/** WCAG 2 relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Distance in OKLab: about 0.02 is a just-visible step. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
