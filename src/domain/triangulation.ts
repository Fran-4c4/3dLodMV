import earcut from 'earcut';
import type { Vec3 } from './cityjson';

export function triangulateSurface(surface: number[][], vertices: Vec3[]): number[] {
  if (!surface[0] || surface[0].length < 3) return [];
  const outer = surface[0].map(index => checkedVertex(index, vertices));

  let nx = 0; let ny = 0; let nz = 0;
  for (let index = 0; index < outer.length; index += 1) {
    const a = outer[index]!;
    const b = outer[(index + 1) % outer.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-10) return [];
  nx /= length; ny /= length; nz /= length;

  let up: Vec3 = [1, 0, 0];
  if (Math.abs(nx) > 0.9) up = [0, 1, 0];
  const ax0 = ny * up[2] - nz * up[1];
  const ay0 = nz * up[0] - nx * up[2];
  const az0 = nx * up[1] - ny * up[0];
  const axisLength = Math.hypot(ax0, ay0, az0);
  const ax = ax0 / axisLength; const ay = ay0 / axisLength; const az = az0 / axisLength;
  const bx = ny * az - nz * ay; const by = nz * ax - nx * az; const bz = nx * ay - ny * ax;

  const flat: number[] = [];
  const holes: number[] = [];
  const sourceIndices: number[] = [];
  for (const [ringIndex, ring] of surface.entries()) {
    if (ringIndex > 0) holes.push(sourceIndices.length);
    for (const sourceIndex of ring) {
      const point = checkedVertex(sourceIndex, vertices);
      flat.push(point[0] * ax + point[1] * ay + point[2] * az);
      flat.push(point[0] * bx + point[1] * by + point[2] * bz);
      sourceIndices.push(sourceIndex);
    }
  }
  return earcut(flat, holes, 2).map(localIndex => sourceIndices[localIndex]!);
}

function checkedVertex(index: number, vertices: Vec3[]): Vec3 {
  if (!Number.isInteger(index) || !vertices[index]) throw new Error(`Vertex index out of range: ${index}`);
  return vertices[index];
}
