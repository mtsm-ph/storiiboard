import Konva from 'konva';
import { cssFamily, fontsStore } from './fonts';
import { estimateTextHeight, LINE_HEIGHT, type MeasureText, type TextBox } from './items';

// How tall a text box is for its text (5.1a): measured the way it is drawn, by Konva's own Text with the font the box is
// drawn in (a family this computer lacks is measured in Inter Tight, as it is shown). Used when an edit is written, so
// the stored height is the height the text takes; where there is no canvas to measure with, the estimate stands in.

/** Konva's font style string for a weight and slant: "italic 700". */
export const fontStyleOf = (weight: number, italic: boolean): string => `${italic ? 'italic ' : ''}${String(weight)}`;

export const measureText: MeasureText = (box: TextBox) => {
  try {
    const node = new Konva.Text({
      text: box.text,
      width: box.width,
      fontFamily: cssFamily(box.fontFamily, fontsStore.getState(), { weight: box.fontWeight, italic: box.fontItalic }),
      fontStyle: fontStyleOf(box.fontWeight, box.fontItalic),
      fontSize: box.fontSize,
      lineHeight: LINE_HEIGHT,
      align: box.align,
    });
    const height = node.height();
    node.destroy();
    return Number.isFinite(height) && height > 0 ? Math.round(Math.max(height, box.fontSize * LINE_HEIGHT) * 100) / 100 : estimateTextHeight(box);
  } catch {
    return estimateTextHeight(box);
  }
};
