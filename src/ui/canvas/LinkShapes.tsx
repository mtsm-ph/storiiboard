import { Group, Line, Path as KonvaPath, Rect, Text } from 'react-konva';
import type { CanvasColours, CanvasLink, Point, Rect as WorldRect } from './types';
import { headDirections, headPoints, headSize, trimmed, type Path } from './routing';

// How a connector is drawn (5.2): its line, its arrowheads, its label on a paper patch, and, when it is the one selected,
// a halo and a square at each end. All in world units, in the canvas's layer; nothing here listens, the canvas picks.

export const LABEL_FONT_SIZE = 14;
const LABEL_FAMILY = '"Inter Tight", sans-serif';

/** A connector worked out: its ends joined, the middle of the path, and the label's patch if it has words (or is being typed). */
export interface ResolvedLink {
  link: CanvasLink;
  path: Path;
  middle: Point;
  patch: WorldRect | null;
}

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/** The line itself; at an arrow end it stops short, under the head, so its square end can't show beside the tip. */
function lineOf(path: Path, startHead: boolean, endHead: boolean, width: number, stroke: string, opacity = 1, extra = 0) {
  const cut = headSize(width) * 0.8;
  const drawn = trimmed(path, startHead ? cut : 0, endHead ? cut : 0);
  if (drawn.kind === 'curve') {
    const [a, b, c, d] = drawn.points;
    return <KonvaPath data={`M${String(a.x)},${String(a.y)} C${String(b.x)},${String(b.y)} ${String(c.x)},${String(c.y)} ${String(d.x)},${String(d.y)}`} stroke={stroke} strokeWidth={width + extra} opacity={opacity} listening={false} />;
  }
  return <Line points={flat(drawn.points)} stroke={stroke} strokeWidth={width + extra} opacity={opacity} lineJoin="round" listening={false} />;
}

interface LinkShapeProps {
  resolved: ResolvedLink;
  colours: CanvasColours;
  selected: boolean;
  /** The label is being typed into: its patch stays, its words are the editor's. */
  hideText: boolean;
  /** The one selected connector shows a square at each end. */
  handles: boolean;
  zoom: number;
  /** A connector being drawn: drawn lighter. */
  draft?: boolean;
}

export function LinkShape({ resolved, colours, selected, hideText, handles, zoom, draft = false }: LinkShapeProps) {
  const { link, path, patch } = resolved;
  const stroke = link.color ?? colours.ink;
  const points = path.points;
  const first = points[0];
  const last = points[points.length - 1];
  const directions = headDirections(path);
  const head = (at: Point | undefined, direction: Point, on: boolean) =>
    on && at ? <Line points={flat(headPoints(at, direction, link.width))} closed fill={stroke} stroke={stroke} strokeWidth={1} lineJoin="round" listening={false} /> : null;
  const square = 8 / zoom;
  return (
    <Group opacity={draft ? 0.7 : 1} listening={false}>
      {selected && lineOf(path, false, false, link.width, colours.ink, 0.22, 6 / zoom)}
      {lineOf(path, link.startHead === 'arrow', link.endHead === 'arrow', link.width, stroke)}
      {head(first, directions.start, link.startHead === 'arrow')}
      {head(last, directions.end, link.endHead === 'arrow')}
      {patch && (
        <Group x={patch.x} y={patch.y} listening={false}>
          <Rect width={patch.width} height={patch.height} fill={colours.paper} {...(selected ? { stroke: colours.ink } : {})} strokeWidth={1} strokeScaleEnabled={false} />
          {!hideText && link.text !== '' && (
            <Text
              width={patch.width}
              height={patch.height}
              text={link.text}
              align="center"
              verticalAlign="middle"
              fontFamily={LABEL_FAMILY}
              fontSize={LABEL_FONT_SIZE}
              lineHeight={1.2}
              fill={colours.ink}
              listening={false}
            />
          )}
        </Group>
      )}
      {handles &&
        [first, last].map((at, i) =>
          at ? <Rect key={i === 0 ? 'from' : 'to'} x={at.x - square / 2} y={at.y - square / 2} width={square} height={square} fill={colours.ink} stroke={colours.paper} strokeWidth={1} strokeScaleEnabled={false} listening={false} /> : null,
        )}
    </Group>
  );
}
