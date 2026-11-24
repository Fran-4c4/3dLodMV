import { Coordinates, GeometryLayer, Source, type GlobeView } from 'itowns';
import * as THREE from 'three';
import { fromArrayBuffer } from 'geotiff';
import { registerCommonCrs } from '../scene/cityjson-layer';

export const TerrainEncoding = Object.freeze({
  MAPBOX: 'mapbox',
  TERRARIUM: 'terrarium',
} as const);

export type TerrainEncoding = typeof TerrainEncoding[keyof typeof TerrainEncoding];

export interface TerrainPreset {
  /** Stable UI identifier; runtime layers receive a per-session suffix. */
  key: string;
  name: string;
  description: string;
  /** XYZ template encoded as Mapbox Terrain-RGB or Terrarium RGB heights. */
  url: string;
  encoding: TerrainEncoding;
  minZoom: number;
  maxZoom: number;
  attribution: { name: string; url: string };
}

export interface TerrainRecord {
  id: string;
  name: string;
  kind: 'remote' | 'local';
  layer: GeometryLayer;
  attribution?: { name: string; url?: string };
  sourceCrs?: string;
  elevationRange?: readonly [number, number];
  center?: THREE.Vector3;
  radius?: number;
  /** Human-readable spatial loading strategy shown in the terrain catalogue. */
  coverage?: string;
}

export const terrainPresets: readonly TerrainPreset[] = [
  {
    key: 'ign-spain-dem',
    name: 'IGN Spain Terrain',
    description: 'Official Spanish elevation tiles · user selected · zoom 5–15',
    url: 'https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png',
    encoding: TerrainEncoding.MAPBOX,
    minZoom: 5,
    maxZoom: 15,
    attribution: { name: '© IGN/CNIG · CC BY 4.0', url: 'https://www.ign.es/' },
  },
  {
    key: 'mapzen-global-terrain',
    name: 'Mapzen Global Terrain',
    description: 'Global bare-earth Terrain Tiles on AWS · Terrarium',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    encoding: TerrainEncoding.TERRARIUM,
    minZoom: 0,
    maxZoom: 15,
    attribution: { name: 'Mapzen Terrain Tiles and source datasets', url: 'https://registry.opendata.aws/terrain-tiles/' },
  },
] as const;

export async function addTerrainPreset(view: GlobeView, preset: TerrainPreset, instance: number, centre: Coordinates): Promise<TerrainRecord> {
  const id = `terrain-${preset.key}-${instance}`;
  const geographic = centre.as('EPSG:4326'); const longitude = geographic.x; const latitude = geographic.y;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || latitude <= -85.051129 || latitude >= 85.051129) throw new Error('The terrain patch centre is outside the Web Mercator domain.');
  const zoom = preset.maxZoom; const tileCount = 2 ** zoom;
  const centreX = Math.floor((longitude + 180) / 360 * tileCount);
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const centreY = Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * tileCount);
  const centreEcef = new Coordinates('EPSG:4326', longitude, latitude, 0).as('EPSG:4978').toVector3();
  const root = new THREE.Group(); root.name = `${preset.name} terrain patch`; root.position.copy(centreEcef);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const box = new THREE.Box3(); const requests: Array<Promise<void>> = [];
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    const tileX = centreX + offsetX; const tileY = centreY + offsetY;
    if (tileX < 0 || tileY < 0 || tileX >= tileCount || tileY >= tileCount) continue;
    const url = preset.url.replace('{z}', String(zoom)).replace('{x}', String(tileX)).replace('{y}', String(tileY));
    requests.push(fetchElevationRaster(url, preset.encoding).then(raster => {
      const geometry = terrainTileGeometry(raster, tileX, tileY, zoom, centreEcef, box);
      root.add(new THREE.Mesh(geometry, material));
    }));
  }
  await Promise.all(requests);
  root.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.55)); root.updateMatrixWorld(true);
  const radius = Math.max(1, box.getBoundingSphere(new THREE.Sphere()).radius);
  const layer = new GeometryLayer(id, root, { source: new Source({ url: preset.url }) });
  (layer as GeometryLayer & { update: () => void }).update = () => undefined;
  await view.addLayer(layer);
  return { id, name: preset.name, kind: 'remote', layer, attribution: preset.attribution, sourceCrs: 'EPSG:3857', center: centreEcef, radius, coverage: `3 × 3 tile patch · zoom ${zoom}` };
}

export async function addLocalCogTerrain(view: GlobeView, buffer: ArrayBuffer, fileName: string): Promise<TerrainRecord> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const directory = image.getFileDirectory();
  if ((directory as unknown as Record<string, unknown>).ModelTransformation) throw new Error('Rotated or matrix-transformed GeoTIFF terrain is not supported yet. Export a north-up COG.');
  const resolution = image.getResolution();
  if (!(resolution[0] > 0) || !(resolution[1] < 0)) throw new Error('The terrain raster must be north-up with positive X and negative Y pixel spacing.');
  const geoKeys = image.getGeoKeys() as { ProjectedCSTypeGeoKey?: number; GeographicTypeGeoKey?: number };
  const epsg = geoKeys.ProjectedCSTypeGeoKey ?? geoKeys.GeographicTypeGeoKey;
  if (!epsg) throw new Error('The GeoTIFF does not declare an EPSG horizontal CRS.');
  const sourceCrs = `EPSG:${epsg}`;
  registerCommonCrs(sourceCrs);

  const sourceWidth = image.getWidth(); const sourceHeight = image.getHeight();
  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = Math.min(1, 257 / longest);
  const width = Math.max(2, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));
  const raster = await image.readRasters({ width, height, samples: [0], interleave: true, resampleMethod: 'bilinear' });
  const values = raster as unknown as ArrayLike<number>;
  const noDataText = image.getGDALNoData();
  const noData = noDataText === null ? undefined : Number(noDataText);
  const [west, south, east, north] = image.getBoundingBox();
  const valid = new Uint8Array(width * height);
  const ecef: Array<THREE.Vector3 | undefined> = new Array(width * height);
  let min = Infinity; let max = -Infinity;
  const box = new THREE.Box3();
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const index = row * width + column;
    const z = Number(values[index]);
    if (!Number.isFinite(z) || (noData !== undefined && z === noData)) continue;
    const x = west + column / (width - 1) * (east - west);
    const y = north - row / (height - 1) * (north - south);
    const point = new Coordinates(sourceCrs, x, y, z).as('EPSG:4978').toVector3();
    valid[index] = 1; ecef[index] = point; box.expandByPoint(point);
    min = Math.min(min, z); max = Math.max(max, z);
  }
  if (box.isEmpty()) throw new Error('The GeoTIFF does not contain finite terrain samples.');
  const center = box.getCenter(new THREE.Vector3());
  const positions = new Float32Array(width * height * 3);
  const colours = new Float32Array(width * height * 3);
  const colour = new THREE.Color();
  let radius = 1;
  for (let index = 0; index < ecef.length; index += 1) {
    const point = ecef[index]; if (!point) continue;
    const relative = point.clone().sub(center); radius = Math.max(radius, relative.length());
    positions.set([relative.x, relative.y, relative.z], index * 3);
    const normalized = max > min ? (Number(values[index]) - min) / (max - min) : 0.5;
    colour.setHSL(0.28 - normalized * 0.2, 0.35, 0.27 + normalized * 0.28);
    colours.set([colour.r, colour.g, colour.b], index * 3);
  }
  const indices: number[] = [];
  for (let row = 0; row < height - 1; row += 1) for (let column = 0; column < width - 1; column += 1) {
    const a = row * width + column; const b = a + 1; const c = a + width; const d = c + 1;
    if (valid[a] && valid[b] && valid[c]) indices.push(a, c, b);
    if (valid[b] && valid[c] && valid[d]) indices.push(b, c, d);
  }
  if (!indices.length) throw new Error('The GeoTIFF has no connected terrain cells after NoData filtering.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  const root = new THREE.Group(); root.name = 'Local terrain'; root.position.copy(center); root.add(mesh, new THREE.HemisphereLight(0xffffff, 0x334455, 1.6)); root.updateMatrixWorld(true);
  const id = `terrain-local-${Date.now()}`;
  const layer = new GeometryLayer(id, root, { source: new Source({ url: 'local-cog' }) });
  (layer as GeometryLayer & { update: () => void }).update = () => undefined;
  await view.addLayer(layer);
  return { id, name: fileName, kind: 'local', layer, sourceCrs, elevationRange: [min, max], center, radius };
}

export function decodeElevationRgb(red: number, green: number, blue: number, encoding: TerrainEncoding): number {
  if (![red, green, blue].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('Elevation RGB channels must be byte values.');
  return encoding === TerrainEncoding.TERRARIUM
    ? red * 256 + green + blue / 256 - 32768
    : -10000 + (red * 65536 + green * 256 + blue) * 0.1;
}

interface ElevationRaster { width: number; height: number; elevation: Float32Array }

async function fetchElevationRaster(url: string, encoding: TerrainEncoding): Promise<ElevationRaster> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`Terrain tile request failed with HTTP ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser cannot decode terrain tiles.');
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const elevation = new Float32Array(canvas.width * canvas.height);
  for (let index = 0; index < elevation.length; index += 1) {
    const offset = index * 4;
    elevation[index] = decodeElevationRgb(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, encoding);
  }
  return { width: canvas.width, height: canvas.height, elevation };
}

function terrainTileGeometry(raster: ElevationRaster, tileX: number, tileY: number, zoom: number, origin: THREE.Vector3, bounds: THREE.Box3): THREE.BufferGeometry {
  const segments = Math.max(1, Math.min(32, Math.max(raster.width - 1, raster.height - 1)));
  const side = segments + 1; const positions = new Float32Array(side * side * 3); const colours = new Float32Array(side * side * 3);
  const colour = new THREE.Color(); let min = Infinity; let max = -Infinity;
  for (const value of raster.elevation) { min = Math.min(min, value); max = Math.max(max, value); }
  const tileCount = 2 ** zoom;
  for (let row = 0; row < side; row += 1) for (let column = 0; column < side; column += 1) {
    const u = column / segments; const v = row / segments;
    const sourceColumn = Math.round(u * (raster.width - 1)); const sourceRow = Math.round(v * (raster.height - 1));
    const elevation = raster.elevation[sourceRow * raster.width + sourceColumn] ?? 0;
    const longitude = (tileX + u) / tileCount * 360 - 180;
    const mercatorY = Math.PI * (1 - 2 * (tileY + v) / tileCount);
    const latitude = THREE.MathUtils.radToDeg(Math.atan(Math.sinh(mercatorY)));
    const point = new Coordinates('EPSG:4326', longitude, latitude, elevation).as('EPSG:4978').toVector3(); bounds.expandByPoint(point);
    const relative = point.sub(origin); const index = (row * side + column) * 3; positions.set([relative.x, relative.y, relative.z], index);
    const normalized = max > min ? (elevation - min) / (max - min) : 0.5; colour.setHSL(0.3 - normalized * 0.18, 0.32, 0.28 + normalized * 0.25);
    colours.set([colour.r, colour.g, colour.b], index);
  }
  const indices: number[] = [];
  for (let row = 0; row < segments; row += 1) for (let column = 0; column < segments; column += 1) {
    const a = row * side + column; const b = a + 1; const c = a + side; const d = c + 1; indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
