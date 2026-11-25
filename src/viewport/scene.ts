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
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  type Ray,
} from 'three';
import { toMm } from '../core/units';
import { UP } from './camera-math';
import { SAMPLE_CABINET, type SampleBoard } from './sample-cabinet';

/** Scene units are millimeters. Document lengths are converted on the way in. */

const COLORS = {
  board: '#ead9b4',
  boardEdge: '#3d3427',
  grid: '#3c4a41',
  axisX: '#c4513a',
  axisY: '#4f8f3a',
  axisZ: '#3b76b8',
} as const;


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

interface Axis {
  line: Line;
  direction: Vector3;
}

function createAxisLine(direction: Vector3, color: string, opacity: number): Axis {
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
function createAxes(): Axis[] {
  return [
    createAxisLine(new Vector3(1, 0, 0), COLORS.axisX, 1),
    createAxisLine(new Vector3(-1, 0, 0), COLORS.axisX, 0.3),
    createAxisLine(new Vector3(0, 1, 0), COLORS.axisY, 1),
    createAxisLine(new Vector3(0, -1, 0), COLORS.axisY, 0.3),
    createAxisLine(new Vector3(0, 0, 1), COLORS.axisZ, 1),
  ];
}

function createBoardMesh(board: SampleBoard, faces: MeshLambertMaterial, edges: LineBasicMaterial): Mesh {
  const [x, y, z] = board.origin.map(toMm) as [number, number, number];
  const [sx, sy, sz] = board.size.map(toMm) as [number, number, number];
  const geometry = new BoxGeometry(sx, sy, sz);
  const mesh = new Mesh(geometry, faces);
  mesh.position.set(x + sx / 2, y + sy / 2, z + sz / 2);
  mesh.name = board.name;
  mesh.add(new LineSegments(new EdgesGeometry(geometry), edges));
  return mesh;
}

export class ViewportScene {
  readonly scene = new Scene();
  /** Smallest sphere around everything that counts as the model. Used to frame views. */
  readonly modelBounds = new Sphere();

  private readonly grid = createGrid();
  private readonly axes = createAxes();
  private readonly boards: Mesh[] = [];
  private readonly raycaster = new Raycaster();
  private readonly floor = new Plane(UP.clone(), 0);

  constructor() {
    const { scene } = this;

    scene.add(new HemisphereLight('#ffffff', '#b8ae99', 2.1));
    const sun = new DirectionalLight('#fff6e6', 1.5);
    sun.position.set(-0.55, -1, 1.3);
    scene.add(sun);

    scene.add(this.grid);
    for (const axis of this.axes) scene.add(axis.line);

    // Faces sit a hair behind their own outlines so edges always draw crisply.
    const faces = new MeshLambertMaterial({
      color: COLORS.board,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const edges = new LineBasicMaterial({ color: COLORS.boardEdge });
    const model = new Group();
    for (const board of SAMPLE_CABINET) {
      const mesh = createBoardMesh(board, faces, edges);
      this.boards.push(mesh);
      model.add(mesh);
    }
    scene.add(model);

    const points: Vector3[] = [];
    for (const board of SAMPLE_CABINET) {
      const [x, y, z] = board.origin.map(toMm) as [number, number, number];
      const [sx, sy, sz] = board.size.map(toMm) as [number, number, number];
      points.push(new Vector3(x, y, z), new Vector3(x + sx, y + sy, z + sz));
    }
    this.modelBounds.setFromPoints(points);
  }

  /**
   * Finds what a ray lands on: a board if it hits one, otherwise the floor.
   * Floor hits far beyond the model are ignored, because near the horizon a
   * tiny cursor movement would otherwise jump the point by a huge distance.
   */
  pick(ray: Ray, maxFloorDistance: number): Vector3 | null {
    this.raycaster.ray.copy(ray);
    const hit = this.raycaster.intersectObjects(this.boards, false)[0];
    if (hit) return hit.point.clone();
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
    this.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line) {
        (object.geometry as BufferGeometry).dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
  }
}
