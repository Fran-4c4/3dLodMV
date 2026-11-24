import { Coordinates, CRS, GeometryLayer, Source } from 'itowns';
import * as THREE from 'three';
import type { CityObject, ParsedCityJson, Vec3 } from '../domain/cityjson';
import { linesOf, surfacesOf } from '../domain/cityjson';
import { triangulateSurface } from '../domain/triangulation';
import {
  applyBuildingPalette,
  CITY_OBJECT_TYPE_COLOURS,
  DEFAULT_BUILDING_PALETTE_SETTINGS,
  FALLBACK_CITY_OBJECT_COLOUR,
  type SourceBounds,
} from './building-palette';

export interface FeatureRecord {
  id: string;
  object: CityObject;
  lods: string[];
  /** Horizontal extent in source CRS units, used only for display palette adjacency. */
  sourceBounds?: SourceBounds;
  mesh?: THREE.Mesh;
  line?: THREE.LineSegments;
}

export interface CityModel {
  layer: GeometryLayer;
  root: THREE.Group;
  features: FeatureRecord[];
  drawableFeatureCount: number;
  center: THREE.Vector3;
  radius: number;
  triangleCount: number;
  lineSegmentCount: number;
  sourceCrs: string;
}

export function registerCommonCrs(sourceCrs: string): void {
  if (sourceCrs === 'EPSG:4326' || sourceCrs === 'EPSG:3857' || sourceCrs === 'EPSG:4978') return;
  const code = Number(sourceCrs.slice(5));
  const regcanZone = code === 4082 ? 27 : code === 4083 ? 28 : undefined;
  const etrsZone = code >= 25828 && code <= 25831 ? code - 25800 : undefined;
  const wgsNorthZone = code >= 32601 && code <= 32660 ? code - 32600 : undefined;
  const wgsSouthZone = code >= 32701 && code <= 32760 ? code - 32700 : undefined;
  if (regcanZone) {
    // EPSG:4082/4083 use REGCAN95 on GRS80. EPSG operation 4084 defines the
    // registry's approximate (±1 m) zero-translation path to WGS 84.
    CRS.defs(sourceCrs, `+proj=utm +zone=${regcanZone} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs`);
  } else if (etrsZone) {
    CRS.defs(sourceCrs, `+proj=utm +zone=${etrsZone} +ellps=GRS80 +units=m +no_defs +type=crs`);
  } else if (wgsNorthZone) {
    CRS.defs(sourceCrs, `+proj=utm +zone=${wgsNorthZone} +datum=WGS84 +units=m +no_defs +type=crs`);
  } else if (wgsSouthZone) {
    CRS.defs(sourceCrs, `+proj=utm +zone=${wgsSouthZone} +south +datum=WGS84 +units=m +no_defs +type=crs`);
  } else {
    throw new Error(`${sourceCrs} is not included in the local CRS catalogue yet.`);
  }
}

export function buildCityModel(parsed: ParsedCityJson): CityModel {
  registerCommonCrs(parsed.sourceCrs);
  CRS.isValid(parsed.sourceCrs);
  const ecef = parsed.vertices.map(vertex => toEcef(vertex, parsed.sourceCrs));
  const center = boundingCenter(ecef);
  const root = new THREE.Group();
  root.name = 'CityJSON';
  root.position.copy(center);

  const features: FeatureRecord[] = [];
  let triangleCount = 0;
  let lineSegmentCount = 0;
  let radius = 1;

  for (const [id, object] of Object.entries(parsed.document.CityObjects)) {
    const positions: number[] = [];
    const linePositions: number[] = [];
    const sourceIndices = new Set<number>();
    const lods = new Set<string>();
    for (const geometry of object.geometry ?? []) {
      if (geometry.lod !== undefined) lods.add(String(geometry.lod));
      for (const surface of surfacesOf(geometry)) {
        for (const ring of surface) for (const sourceIndex of ring) {
          if (Number.isInteger(sourceIndex) && parsed.vertices[sourceIndex]) sourceIndices.add(sourceIndex);
        }
        const indices = triangulateSurface(surface, parsed.vertices);
        for (const sourceIndex of indices) pushRelative(positions, ecef[sourceIndex]!, center);
      }
      for (const line of linesOf(geometry)) {
        for (let index = 1; index < line.length; index += 1) {
          const a = ecef[line[index - 1]!]; const b = ecef[line[index]!];
          if (!a || !b) throw new Error(`Line index out of range in ${id}.`);
          sourceIndices.add(line[index - 1]!); sourceIndices.add(line[index]!);
          pushRelative(linePositions, a, center);
          pushRelative(linePositions, b, center);
        }
      }
    }

    const record: FeatureRecord = { id, object, lods: [...lods].sort(), sourceBounds: sourceBounds(sourceIndices, parsed.vertices) };
    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: CITY_OBJECT_TYPE_COLOURS[object.type] ?? FALLBACK_CITY_OBJECT_COLOUR,
        roughness: 0.72,
        metalness: 0.03,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = id;
      mesh.userData.featureId = id;
      root.add(mesh);
      record.mesh = mesh;
      triangleCount += positions.length / 9;
    }
    if (linePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffd166 }));
      line.name = id;
      line.userData.featureId = id;
      root.add(line);
      record.line = line;
      lineSegmentCount += linePositions.length / 6;
    }
    features.push(record);
  }

  for (const point of ecef) radius = Math.max(radius, point.distanceTo(center));
  const light = new THREE.HemisphereLight(0xffffff, 0x334455, 2.2);
  root.add(light);
  // iTowns disables automatic world-matrix traversal on its root scene.
  root.updateMatrixWorld(true);
  const layer = new GeometryLayer('cityjson-model', root, { source: new Source({ url: 'none' }) });
  (layer as GeometryLayer & { update: () => void }).update = () => undefined;
  const drawableFeatureCount = features.filter(feature => feature.mesh || feature.line).length;
  const model = { layer, root, features, drawableFeatureCount, center, radius, triangleCount, lineSegmentCount, sourceCrs: parsed.sourceCrs };
  applyBuildingPalette(features, { ...DEFAULT_BUILDING_PALETTE_SETTINGS });
  return model;
}

export function setModelWireframe(model: CityModel, enabled: boolean): void {
  for (const feature of model.features) {
    if (feature.mesh?.material instanceof THREE.MeshStandardMaterial) feature.mesh.material.wireframe = enabled;
  }
}

export function setFeatureSelected(feature: FeatureRecord | undefined, selected: boolean): void {
  const material = feature?.mesh?.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.emissive.set(selected ? 0x2b79ff : 0x000000);
    material.emissiveIntensity = selected ? 0.65 : 0;
  }
}

function toEcef(vertex: Vec3, sourceCrs: string): THREE.Vector3 {
  return new Coordinates(sourceCrs, vertex[0], vertex[1], vertex[2]).as('EPSG:4978').toVector3();
}

function boundingCenter(points: THREE.Vector3[]): THREE.Vector3 {
  if (points.length === 0) throw new Error('The CityJSON file contains no vertices.');
  const box = new THREE.Box3();
  for (const point of points) box.expandByPoint(point);
  return box.getCenter(new THREE.Vector3());
}

function pushRelative(target: number[], point: THREE.Vector3, center: THREE.Vector3): void {
  target.push(point.x - center.x, point.y - center.y, point.z - center.z);
}

function sourceBounds(indices: ReadonlySet<number>, vertices: readonly Vec3[]): SourceBounds | undefined {
  if (!indices.size) return undefined;
  const bounds: SourceBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const index of indices) {
    const vertex = vertices[index];
    if (!vertex) continue;
    bounds.minX = Math.min(bounds.minX, vertex[0]); bounds.minY = Math.min(bounds.minY, vertex[1]);
    bounds.maxX = Math.max(bounds.maxX, vertex[0]); bounds.maxY = Math.max(bounds.maxY, vertex[1]);
  }
  return Number.isFinite(bounds.minX) ? bounds : undefined;
}
