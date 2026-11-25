import type { Vec3L } from '../core/vec';
import type { ToolPreview } from '../tools/tool';

type ScreenPoint = { x: number; y: number };
type Project = (point: Vec3L) => ScreenPoint | null;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DIMENSIONS = 3;

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

/**
 * Flat markings drawn on top of the 3D view: the snap marker with its label,
 * the dotted line back to whatever a point is lined up with, and the sizes
 * shown while drawing. They are ordinary page elements, so text stays sharp
 * and the same size at every zoom.
 */
export class ViewportOverlay {
  private readonly root: HTMLDivElement;
  private readonly guide: SVGLineElement;
  private readonly source: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private readonly markerLabel: HTMLSpanElement;
  private readonly dimensions: HTMLDivElement[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'viewport-overlay';
    container.appendChild(this.root);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'overlay-lines');
    this.guide = document.createElementNS(SVG_NS, 'line');
    this.guide.setAttribute('class', 'overlay-guide');
    this.guide.style.display = 'none';
    svg.appendChild(this.guide);
    this.root.appendChild(svg);

    this.source = element('snap-source', this.root);
    this.marker = element('snap-marker', this.root);
    this.marker.appendChild(document.createElement('i'));
    this.markerLabel = document.createElement('span');
    this.marker.appendChild(this.markerLabel);
    for (let index = 0; index < MAX_DIMENSIONS; index += 1) {
      this.dimensions.push(element('dimension-label', this.root));
    }
  }

  update(preview: ToolPreview, project: Project): void {
    const { marker } = preview;
    const at = marker ? project(marker.point) : null;
    if (place(this.marker, at) && marker) {
      this.marker.dataset.kind = marker.kind;
      this.marker.toggleAttribute('data-aligned', marker.source !== null);
      this.markerLabel.textContent = marker.label;
    }

    const from = at && marker?.source ? project(marker.source) : null;
    place(this.source, from);
    this.guide.style.display = from ? '' : 'none';
    if (at && from) {
      this.guide.setAttribute('x1', from.x.toFixed(1));
      this.guide.setAttribute('y1', from.y.toFixed(1));
      this.guide.setAttribute('x2', at.x.toFixed(1));
      this.guide.setAttribute('y2', at.y.toFixed(1));
    }

    this.dimensions.forEach((label, index) => {
      const dimension = preview.dimensions[index];
      const a = dimension ? project(dimension.from) : null;
      const b = dimension ? project(dimension.to) : null;
      if (place(label, a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null) && dimension) {
        label.textContent = dimension.text;
      }
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
