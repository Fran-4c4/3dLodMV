import { Coordinates, ElevationLayer, Extent, TMSSource, type GlobeView } from 'itowns';
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
  /** Native globe displacement. iTowns defines scale dynamically (1 = metres, 0 = hidden). */
  layer: ElevationLayer & { scale: number };
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
  const tiles = new Map<number, ElevationRaster>();
  const requests: Promise<void>[] = [];
  const left = Math.max(0, centreX - 1), right = Math.min(tileCount - 1, centreX + 1);
  const top = Math.max(0, centreY - 1), bottom = Math.min(tileCount - 1, centreY + 1);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const url = preset.url.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
    requests.push(fetchElevationRaster(url, preset.encoding).then(raster => { tiles.set(y * tileCount + x, raster); }));
  }
  await Promise.all(requests);
  const tileLatitude = (y: number) => THREE.MathUtils.radToDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / tileCount))));
  const bounds = new Extent('EPSG:4326', left / tileCount * 360 - 180, (right + 1) / tileCount * 360 - 180,
    tileLatitude(bottom + 1), tileLatitude(top));
  const sampleTile = tiles.get(top * tileCount + left)!;
  const columns = (right - left + 1) * sampleTile.width;
  const rows = (bottom - top + 1) * sampleTile.height;
  const layer = await addGlobeElevation(view, id, bounds, columns, rows, (lon, lat) => {
    const x = (lon + 180) / 360 * tileCount;
    const y = (1 - Math.asinh(Math.tan(THREE.MathUtils.degToRad(lat))) / Math.PI) / 2 * tileCount;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < left || tx > right || ty < top || ty > bottom) return 0;
    const raster = tiles.get(ty * tileCount + tx);
    if (!raster) return 0;
    return raster.elevation[Math.floor((y - ty) * raster.height) * raster.width + Math.floor((x - tx) * raster.width)];
  });
  const corner = new Coordinates('EPSG:4326', bounds.west, bounds.north, 0).as('EPSG:4978').toVector3();
  const opposite = new Coordinates('EPSG:4326', bounds.east, bounds.south, 0).as('EPSG:4978').toVector3();
  const radius = Math.max(1, centreEcef.distanceTo(corner), centreEcef.distanceTo(opposite));
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
  let min = Infinity; let max = -Infinity;
  const box = new THREE.Box3();
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const index = row * width + column;
    const z = Number(values[index]);
    if (!Number.isFinite(z) || (noData !== undefined && z === noData)) continue;
    const x = west + column / (width - 1) * (east - west);
    const y = north - row / (height - 1) * (north - south);
    const point = new Coordinates(sourceCrs, x, y, z).as('EPSG:4978').toVector3();
    valid[index] = 1; box.expandByPoint(point);
    min = Math.min(min, z); max = Math.max(max, z);
  }
  if (box.isEmpty()) throw new Error('The GeoTIFF does not contain finite terrain samples.');
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1, box.getBoundingSphere(new THREE.Sphere()).radius);
  const connected = valid.some((value, i) => i % width < width - 1 && i + width < valid.length &&
    valid[i + 1] && valid[i + width] && (value || valid[i + width + 1]));
  if (!connected) throw new Error('The GeoTIFF has no connected terrain cells after NoData filtering.');
  const bounds = new Extent(sourceCrs, west, east, south, north).as('EPSG:4326');
  const geographic = new Coordinates('EPSG:4326');
  const projected = new Coordinates(sourceCrs);
  const id = `terrain-local-${Date.now()}`;
  const layer = await addGlobeElevation(view, id, bounds, width, height, (lon, lat) => {
    geographic.setFromValues(lon, lat, 0).as(sourceCrs, projected);
    const u = (projected.x - west) / (east - west), v = (north - projected.y) / (north - south);
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const index = Math.min(height - 1, Math.floor(v * height)) * width + Math.min(width - 1, Math.floor(u * width));
    return valid[index] ? Number(values[index]) : 0;
  });
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
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
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

// GlobeView consumes elevation in its geographic tile matrix. Imagery is then
// composited by the same globe material, including opacity and layer order.
async function addGlobeElevation(view: GlobeView, id: string, bounds: Extent, columns: number, rows: number,
  sample: (lon: number, lat: number) => number) {
  const size = 64;
  // Stop generating child textures once a geographic texel resolves a source pixel.
  // Also resolve the footprint when a source contains only a handful of samples.
  const pixelSpan = Math.min((bounds.east - bounds.west) / (columns + 2), (bounds.north - bounds.south) / (rows + 2));
  const maxZoom = Math.max(0, Math.ceil(Math.log2(180 / (size * pixelSpan))));

  const source = new TMSSource({
    crs: 'EPSG:4326', url: 'memory://terrain/${z}/${x}/${y}', extent: bounds, zoom: { min: 0, max: maxZoom },
    fetcher: async () => undefined,
    parser: (_: unknown, { extent }: { extent: { toExtent(crs: string): Extent } }) => {
      const tile = extent.toExtent('EPSG:4326');
      const data = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        const lat = tile.north - (y + 0.5) / size * (tile.north - tile.south);
        if (lat < bounds.south || lat > bounds.north) continue;
        for (let x = 0; x < size; x++) {
          const lon = tile.west + (x + 0.5) / size * (tile.east - tile.west);
          if (lon >= bounds.west && lon <= bounds.east) data[y * size + x] = sample(lon, lat);
        }
      }
      const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
      texture.needsUpdate = true;
      return Object.assign(texture, { extent });
    },
  });
  // A custom parser normally signals vector features to iTowns. These are raster tiles.
  source.isVectorSource = false;
  source.extentInsideLimit = (extent: Extent, zoom: number) => zoom <= maxZoom && bounds.intersectsExtent(extent);
  const options = { source, extent: bounds, noDataValue: undefined };
  const layer = new ElevationLayer(id, options) as TerrainRecord['layer'];
  await view.addLayer(layer);
  return layer;
}
