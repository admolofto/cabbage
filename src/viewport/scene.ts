import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Plane,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  type Material,
  type Ray,
} from 'three';
import type { Board, Box } from '../core/board';
import { toMm } from '../core/units';
import type { Vec3L } from '../core/vec';
import { firstSurfaceHit } from '../inference/inference';
import type { ToolPreview } from '../tools/tool';
import { UP } from './camera-math';

/** Scene units are millimeters. Document lengths are converted on the way in. */

const COLORS = {
  board: '#ead9b4',
  boardSelected: '#cfe0f3',
  boardEdge: '#3d3427',
  highlight: '#1c64d1',
  preview: '#1c64d1',
  grid: '#3c4a41',
  axisX: '#c4513a',
  axisY: '#4f8f3a',
  axisZ: '#3b76b8',
} as const;

/** What the view frames when the model is empty: about a sheet of plywood around the origin. */
const EMPTY_BOUNDS = new Sphere(new Vector3(450, 300, 250), 900);

const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform float uMinor;
  uniform float uMajor;
  uniform vec3 uColor;
  uniform vec2 uCenter;
  uniform float uRadius;
  varying vec2 vWorld;

  // One set of grid lines, about a pixel wide, that fades out where the lines
  // would crowd together instead of turning into a shimmer.
  float gridLayer(float spacing) {
    vec2 cell = vWorld / spacing;
    vec2 cellsPerPixel = max(fwidth(cell), vec2(1e-6));
    vec2 distanceInPixels = abs(fract(cell - 0.5) - 0.5) / cellsPerPixel;
    float line = 1.0 - min(min(distanceInPixels.x, distanceInPixels.y), 1.0);
    float crowding = max(cellsPerPixel.x, cellsPerPixel.y);
    return line * (1.0 - smoothstep(0.06, 0.24, crowding));
  }

  void main() {
    float minor = gridLayer(uMinor) * 0.14;
    float major = gridLayer(uMajor) * 0.36;
    float falloff = 1.0 - smoothstep(uRadius * 0.3, uRadius, distance(vWorld, uCenter));
    float alpha = max(minor, major) * falloff;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function createGrid(): Mesh<PlaneGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    vertexShader: GRID_VERTEX_SHADER,
    fragmentShader: GRID_FRAGMENT_SHADER,
    uniforms: {
      uMinor: { value: 25.4 },
      uMajor: { value: 304.8 },
      uColor: { value: new Color(COLORS.grid) },
      uCenter: { value: new Vector2() },
      uRadius: { value: 10_000 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const grid = new Mesh(new PlaneGeometry(2, 2), material);
  grid.renderOrder = 1;
  grid.frustumCulled = false;
  return grid;
}

interface AxisLine {
  line: Line;
  direction: Vector3;
}

function createAxisLine(direction: Vector3, color: string, opacity: number): AxisLine {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const material = new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const line = new Line(geometry, material);
  line.renderOrder = 2;
  line.frustumCulled = false;
  return { line, direction };
}

/**
 * Colored axes through the origin: X red, Y green, Z blue. The negative halves
 * of X and Y are drawn fainter. Z has no negative half, because it would only
 * ever show through the floor.
 */
function createAxes(): AxisLine[] {
  return [
    createAxisLine(new Vector3(1, 0, 0), COLORS.axisX, 1),
    createAxisLine(new Vector3(-1, 0, 0), COLORS.axisX, 0.3),
    createAxisLine(new Vector3(0, 1, 0), COLORS.axisY, 1),
    createAxisLine(new Vector3(0, -1, 0), COLORS.axisY, 0.3),
    createAxisLine(new Vector3(0, 0, 1), COLORS.axisZ, 1),
  ];
}

function toScene(point: Vec3L): [number, number, number] {
  return [toMm(point[0]), toMm(point[1]), toMm(point[2])];
}

/** Moves and stretches a unit cube, centered on the origin, to fill a box. */
function fitToBox(object: Mesh | LineSegments, box: Box): void {
  const [x, y, z] = toScene(box.min);
  const [sx, sy, sz] = toScene(box.size);
  object.position.set(x + sx / 2, y + sy / 2, z + sz / 2);
  object.scale.set(sx, sy, sz);
}

interface BoardView {
  board: Board;
  mesh: Mesh;
  outline: LineSegments;
}

type BoardLook = 'plain' | 'hovered' | 'selected';

export class ViewportScene {
  readonly scene = new Scene();
  /** Smallest sphere around everything that counts as the model. Used to frame views. */
  readonly modelBounds = EMPTY_BOUNDS.clone();

  private readonly grid = createGrid();
  private readonly axes = createAxes();
  private readonly floor = new Plane(UP.clone(), 0);

  // Every board is the same unit cube, stretched. Faces sit a hair behind their
  // own outlines so edges always draw crisply.
  private readonly cube = new BoxGeometry(1, 1, 1);
  private readonly cubeEdges = new EdgesGeometry(this.cube);
  private readonly faceMaterials: Record<BoardLook, MeshLambertMaterial>;
  private readonly edgeMaterials: Record<BoardLook, LineBasicMaterial>;
  private readonly model = new Group();
  private readonly views = new Map<string, BoardView>();
  private boards: readonly Board[] = [];

  private readonly previewOutline: LineLoop;
  private readonly previewFill: Mesh;
  private readonly previewBox: Mesh;
  private readonly previewBoxEdges: LineSegments;

  constructor() {
    const { scene } = this;

    scene.add(new HemisphereLight('#ffffff', '#b8ae99', 2.1));
    const sun = new DirectionalLight('#fff6e6', 1.5);
    sun.position.set(-0.55, -1, 1.3);
    scene.add(sun);

    scene.add(this.grid);
    for (const axis of this.axes) scene.add(axis.line);

    const face = (color: string) =>
      new MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.faceMaterials = {
      plain: face(COLORS.board),
      hovered: face(COLORS.board),
      selected: face(COLORS.boardSelected),
    };
    this.edgeMaterials = {
      plain: new LineBasicMaterial({ color: COLORS.boardEdge }),
      hovered: new LineBasicMaterial({ color: COLORS.highlight }),
      selected: new LineBasicMaterial({ color: COLORS.highlight }),
    };
    scene.add(this.model);

    // What a tool is about to make is drawn over everything, so it is never hidden behind a board.
    const overlayLine = new LineBasicMaterial({ color: COLORS.preview, depthTest: false, transparent: true });
    const outlineGeometry = new BufferGeometry();
    outlineGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
    this.previewOutline = new LineLoop(outlineGeometry, overlayLine);

    const fillGeometry = new BufferGeometry();
    fillGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
    fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.previewFill = new Mesh(
      fillGeometry,
      new MeshBasicMaterial({
        color: COLORS.preview,
        transparent: true,
        opacity: 0.14,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );

    this.previewBox = new Mesh(
      this.cube,
      new MeshLambertMaterial({
        color: COLORS.board,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    this.previewBoxEdges = new LineSegments(this.cubeEdges, overlayLine);

    for (const object of [this.previewFill, this.previewOutline, this.previewBox, this.previewBoxEdges]) {
      object.visible = false;
      object.frustumCulled = false;
      object.renderOrder = 10;
      scene.add(object);
    }
    this.previewBox.renderOrder = 9;
  }

  /** Brings the drawn boards in line with the model, and marks the hovered and selected ones. */
  setBoards(boards: readonly Board[], selection: ReadonlySet<string>, hovered: string | null): void {
    if (boards !== this.boards) {
      this.boards = boards;
      const ids = new Set<string>();
      for (const board of boards) {
        ids.add(board.id);
        let view = this.views.get(board.id);
        if (!view) {
          const mesh = new Mesh(this.cube, this.faceMaterials.plain);
          const outline = new LineSegments(this.cubeEdges, this.edgeMaterials.plain);
          view = { board, mesh, outline };
          this.views.set(board.id, view);
          this.model.add(mesh, outline);
        } else if (view.board === board) {
          continue;
        }
        view.board = board;
        fitToBox(view.mesh, board);
        fitToBox(view.outline, board);
      }
      for (const [id, view] of this.views) {
        if (ids.has(id)) continue;
        this.model.remove(view.mesh, view.outline);
        this.views.delete(id);
      }
      this.updateBounds();
    }

    for (const [id, view] of this.views) {
      const look: BoardLook = selection.has(id) ? 'selected' : id === hovered ? 'hovered' : 'plain';
      view.mesh.material = this.faceMaterials[look];
      view.outline.material = this.edgeMaterials[look];
      // Highlighted outlines draw last so a neighbor's plain edge never covers them.
      view.outline.renderOrder = look === 'plain' ? 0 : 3;
    }
  }

  /** Draws what the active tool is in the middle of making. */
  setPreview(preview: ToolPreview): void {
    const { outline, box } = preview;
    this.previewOutline.visible = this.previewFill.visible = outline !== null && outline.length === 4;
    if (outline && outline.length === 4) {
      for (const object of [this.previewOutline, this.previewFill]) {
        const position = object.geometry.getAttribute('position');
        outline.forEach((point, index) => position.setXYZ(index, ...toScene(point)));
        position.needsUpdate = true;
      }
    }
    this.previewBox.visible = this.previewBoxEdges.visible = box !== null;
    if (box) {
      fitToBox(this.previewBox, box);
      fitToBox(this.previewBoxEdges, box);
    }
  }

  /**
   * Finds what a ray lands on: a board if it hits one, otherwise the floor.
   * Floor hits far beyond the model are ignored, because near the horizon a
   * tiny cursor movement would otherwise jump the point by a huge distance.
   */
  pick(ray: Ray, maxFloorDistance: number): Vector3 | null {
    const hit = firstSurfaceHit(this.boards, ray);
    if (hit) return ray.at(hit.distance, new Vector3());
    const floorPoint = this.pickFloor(ray);
    if (floorPoint && floorPoint.distanceTo(ray.origin) <= maxFloorDistance) return floorPoint;
    return null;
  }

  pickFloor(ray: Ray): Vector3 | null {
    return ray.intersectPlane(this.floor, new Vector3());
  }

  /** Sets the grid spacing in millimeters and keeps the drawn patch of floor centered under the view. */
  setGrid(minor: number, major: number, center: Vector3, radius: number): void {
    const { uniforms } = this.grid.material;
    uniforms.uMinor!.value = minor;
    uniforms.uMajor!.value = major;
    (uniforms.uCenter!.value as Vector2).set(center.x, center.y);
    uniforms.uRadius!.value = radius;
    this.grid.position.set(center.x, center.y, 0);
    this.grid.scale.set(radius, radius, 1);
  }

  /**
   * Trims each axis to the part in front of the camera, out to `reach`.
   *
   * A line that runs from in front of the camera to far behind it is left to
   * the graphics driver to clip, and some drivers drop the whole line instead.
   * Trimming here keeps the axes visible from every angle.
   */
  updateAxes(cameraPosition: Vector3, viewDirection: Vector3, near: number, reach: number): void {
    // Depth of the origin in front of the camera, measured past the near plane.
    const originDepth = -cameraPosition.dot(viewDirection) - near * 1.5;
    for (const { line, direction } of this.axes) {
      const depthPerUnit = direction.dot(viewDirection);
      let start = 0;
      let end = reach;
      if (depthPerUnit > 1e-9) {
        start = Math.max(start, -originDepth / depthPerUnit);
      } else if (depthPerUnit < -1e-9) {
        end = Math.min(end, -originDepth / depthPerUnit);
      } else if (originDepth < 0) {
        end = start;
      }
      line.visible = end > start;
      if (!line.visible) continue;
      const position = line.geometry.getAttribute('position');
      position.setXYZ(0, direction.x * start, direction.y * start, direction.z * start);
      position.setXYZ(1, direction.x * end, direction.y * end, direction.z * end);
      position.needsUpdate = true;
    }
  }

  dispose(): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    this.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line) {
        geometries.add(object.geometry as BufferGeometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
        }
      }
    });
    for (const material of [...Object.values(this.faceMaterials), ...Object.values(this.edgeMaterials)]) {
      materials.add(material);
    }
    geometries.add(this.cube).add(this.cubeEdges);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  private updateBounds(): void {
    if (this.boards.length === 0) {
      this.modelBounds.copy(EMPTY_BOUNDS);
      return;
    }
    const points: Vector3[] = [];
    for (const board of this.boards) {
      const [x, y, z] = toScene(board.min);
      const [sx, sy, sz] = toScene(board.size);
      points.push(new Vector3(x, y, z), new Vector3(x + sx, y + sy, z + sz));
    }
    // The sphere around the box that holds every board.
    const low = points[0]!.clone();
    const high = points[0]!.clone();
    for (const point of points) {
      low.min(point);
      high.max(point);
    }
    this.modelBounds.center.copy(low).add(high).multiplyScalar(0.5);
    this.modelBounds.radius = Math.max(low.distanceTo(high) / 2, 150);
  }
}
