import { Vector3 } from "three";

export type DieFace = { vertices: Vector3[]; center: Vector3; normal: Vector3; up: Vector3 };
export type ActivityDie = { faces: DieFace[]; shell: DieFace[] };

function face(points: Vector3[]): DieFace {
  const vertices = points.map((point) => point.clone());
  const center = vertices.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(vertices.length);
  const normal = vertices[1]!.clone().sub(vertices[0]!).cross(vertices[2]!.clone().sub(vertices[0]!)).normalize();
  if (normal.dot(center) < 0) { vertices.reverse(); normal.negate(); }
  const apex = vertices.reduce((best, point) => point.distanceToSquared(center) > best.distanceToSquared(center) ? point : best);
  let up = vertices.length === 3 ? apex.clone().sub(center) : new Vector3(0, 0, 1);
  up.addScaledVector(normal, -up.dot(normal));
  if (up.lengthSq() < .001) up = new Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
  return { vertices, center, normal, up: up.normalize() };
}

function prism(sides: number, depth = .68) {
  const rings = [-depth, depth].map((z) => Array.from({ length: sides }, (_, i) => new Vector3(1.3 * Math.cos(i * Math.PI * 2 / sides), 1.3 * Math.sin(i * Math.PI * 2 / sides), z)));
  return [face(rings[1]!), face(rings[0]!), ...rings[0]!.map((point, i) => face([point, rings[0]![(i + 1) % sides]!, rings[1]![(i + 1) % sides]!, rings[1]![i]!]))];
}

/** Exactly one outcome face per activity; tiny bevels/endcaps are structural only. */
export function activityDie(count: number): ActivityDie {
  if (!Number.isInteger(count) || count < 0 || count > 128) throw new Error("Invalid activity face count");
  if (!count) return { faces: [], shell: [] };
  let shell: DieFace[], faces: DieFace[];
  if (count <= 2) { shell = prism(32, .16); faces = shell.slice(0, count); }
  else if (count === 3) { shell = prism(3); faces = shell.slice(2); }
  else if (count === 4) {
    const vertices = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map(([x, y, z]) => new Vector3(x, y, z));
    shell = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]].map((indices) => face(indices.map((i) => vertices[i]!)));
    faces = shell;
  } else if (count === 6 || count % 2) { shell = prism(count - 2); faces = shell; }
  else {
    const sides = count / 2;
    const ring = Array.from({ length: sides }, (_, i) => new Vector3(1.5 * Math.cos(i * Math.PI * 2 / sides), 0, 1.5 * Math.sin(i * Math.PI * 2 / sides)));
    const top = new Vector3(0, 1.55, 0), bottom = new Vector3(0, -1.55, 0);
    shell = ring.flatMap((point, i) => [face([top, point, ring[(i + 1) % sides]!]), face([bottom, ring[(i + 1) % sides]!, point])]);
    faces = shell;
  }
  const scale = 1.55 / Math.max(...shell.flatMap((item) => item.vertices.map((point) => point.length())));
  const scaled = new Map(shell.map((item) => [item, face(item.vertices.map((point) => point.clone().multiplyScalar(scale)))]));
  return { shell: shell.map((item) => scaled.get(item)!), faces: faces.map((item) => scaled.get(item)!) };
}

/** Planar UVs cover the complete face, including non-triangular activity faces. */
export function faceUv(item: DieFace): number[] {
  const right = item.up.clone().cross(item.normal).normalize();
  const coordinates = item.vertices.map((point) => point.clone().sub(item.center)).map((point) => [point.dot(right), point.dot(item.up)]);
  const xs = coordinates.map(([x]) => x!), ys = coordinates.map(([, y]) => y!);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  return coordinates.flatMap(([x, y]) => [(x! - minX) / width, (y! - minY) / height]);
}
