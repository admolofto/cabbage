import type { Guide } from '../core/document';
import { withAxis, type Axis, type Vec3L } from '../core/vec';
import type { ToolPreview } from '../tools/tool';
import type { ScreenPoint } from './clip';


/** How the overlay turns model points into screen points. */
export interface Projection {
  point: (point: Vec3L) => ScreenPoint | null;
  /** A line between two points, cut down to the part that is in front of the camera and in view. */
  segment: (from: Vec3L, to: Vec3L) => [ScreenPoint, ScreenPoint] | null;
  /** How far each way a guide is drawn, in millimeters. */
  reach: number;
}

export interface OverlayContent {
  preview: ToolPreview;
  guides: readonly Guide[];
  selection: ReadonlySet<string>;
  hovered: string | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DIMENSIONS = 3;
const NM_PER_MM = 1_000_000;

function element(className: string, parent: HTMLElement): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  node.hidden = true;
  parent.appendChild(node);
  return node;
}

function place(node: HTMLElement, at: ScreenPoint | null): boolean {
  node.hidden = at === null;
  if (at) node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
  return at !== null;
}

/** The two far ends of a guide. */
function guideEnds(axis: Axis, through: Vec3L, reach: number): [Vec3L, Vec3L] {
  return [withAxis(through, axis, -reach * NM_PER_MM), withAxis(through, axis, reach * NM_PER_MM)];
}

/**
 * Flat markings drawn on top of the 3D view: guides, the snap marker with its
 * label, the dotted line back to whatever a point is lined up with, the lines
 * a tool is working along, and the sizes shown while drawing. They are
 * ordinary page elements, so text stays sharp and the same size at every zoom.
 */
export class ViewportOverlay {
  private readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly lines: SVGLineElement[] = [];
  private readonly source: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private readonly markerLabel: HTMLSpanElement;
  private readonly rect: HTMLDivElement;
  private readonly dimensions: HTMLDivElement[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'viewport-overlay';
    container.appendChild(this.root);

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'overlay-lines');
    this.root.appendChild(this.svg);

    this.rect = element('select-rect', this.root);
    this.source = element('snap-source', this.root);
    this.marker = element('snap-marker', this.root);
    this.marker.appendChild(document.createElement('i'));
    this.markerLabel = document.createElement('span');
    this.marker.appendChild(this.markerLabel);
    for (let index = 0; index < MAX_DIMENSIONS; index += 1) {
      this.dimensions.push(element('dimension-label', this.root));
    }
  }

  update({ preview, guides, selection, hovered }: OverlayContent, project: Projection): void {
    let used = 0;
    const draw = (ends: [ScreenPoint, ScreenPoint] | null, look: string) => {
      if (!ends) return;
      let line = this.lines[used];
      if (!line) {
        line = document.createElementNS(SVG_NS, 'line');
        this.svg.appendChild(line);
        this.lines.push(line);
      }
      used += 1;
      const [a, b] = ends;
      line.setAttribute('class', look);
      line.setAttribute('x1', a.x.toFixed(1));
      line.setAttribute('y1', a.y.toFixed(1));
      line.setAttribute('x2', b.x.toFixed(1));
      line.setAttribute('y2', b.y.toFixed(1));
      line.style.display = '';
    };

    for (const guide of guides) {
      const look = selection.has(guide.id) ? 'selected' : guide.id === hovered ? 'hovered' : 'plain';
      draw(project.segment(...guideEnds(guide.axis, guide.through, project.reach)), `overlay-guide ${look}`);
    }
    if (preview.guide) {
      const ends = guideEnds(preview.guide.axis, preview.guide.through, project.reach);
      draw(project.segment(...ends), 'overlay-guide pending');
    }
    for (const line of preview.lines) {
      draw(project.segment(line.from, line.to), `overlay-line axis-${line.axis ?? 'none'}`);
    }

    const { marker } = preview;
    const at = marker ? project.point(marker.point) : null;
    if (place(this.marker, at) && marker) {
      this.marker.dataset.kind = marker.kind;
      this.marker.toggleAttribute('data-aligned', marker.source !== null);
      this.markerLabel.textContent = marker.label;
    }
    const from = at && marker?.source ? project.point(marker.source) : null;
    place(this.source, from);
    if (at && from) draw([from, at], 'overlay-alignment');

    for (let index = used; index < this.lines.length; index += 1) this.lines[index]!.style.display = 'none';

    const { rect } = preview;
    this.rect.hidden = rect === null;
    if (rect) {
      this.rect.toggleAttribute('data-crossing', rect.crossing);
      this.rect.style.left = `${Math.min(rect.x0, rect.x1)}px`;
      this.rect.style.top = `${Math.min(rect.y0, rect.y1)}px`;
      this.rect.style.width = `${Math.abs(rect.x1 - rect.x0)}px`;
      this.rect.style.height = `${Math.abs(rect.y1 - rect.y0)}px`;
    }

    this.dimensions.forEach((label, index) => {
      const dimension = preview.dimensions[index];
      const a = dimension ? project.point(dimension.from) : null;
      const b = dimension ? project.point(dimension.to) : null;
      if (place(label, a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null) && dimension) {
        label.textContent = dimension.text;
      }
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
