export type Vec3 = readonly [number, number, number];

export interface CityJsonTransform {
  /** Per-axis multiplier applied before translation. */
  scale: [number, number, number];
  /** Per-axis translation applied after scaling. */
  translate: [number, number, number];
}

export interface CityGeometry {
  type: string;
  lod?: number | string;
  boundaries: unknown;
}

export interface CityObject {
  type: string;
  attributes?: Record<string, unknown>;
  geometry?: CityGeometry[];
  parents?: string[];
  children?: string[];
}

export interface CityJsonDocument {
  type: 'CityJSON';
  version?: string;
  transform?: CityJsonTransform;
  vertices: number[][];
  CityObjects: Record<string, CityObject>;
  metadata?: Record<string, unknown> & { referenceSystem?: string };
}

export interface ParsedCityJson {
  document: CityJsonDocument;
  sourceCrs: string;
  vertices: Vec3[];
}

const supportedGeometry = new Set([
  'MultiSurface',
  'CompositeSurface',
  'Solid',
  'MultiSolid',
  'CompositeSolid',
  'MultiLineString',
]);

function isFiniteTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite);
}

export function parseReferenceSystem(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('The CityJSON file does not declare metadata.referenceSystem.');
  }
  const match = value.match(/EPSG(?::|::|\/0\/|\/)(\d+)$/i) ?? value.match(/EPSG[^0-9]*(\d+)/i);
  if (!match?.[1]) {
    throw new Error(`The declared CRS is not recognized: ${value}`);
  }
  return `EPSG:${match[1]}`;
}

export function parseCityJson(input: unknown): ParsedCityJson {
  if (!input || typeof input !== 'object') throw new Error('The file does not contain a JSON object.');
  const document = input as Partial<CityJsonDocument>;
  if (document.type !== 'CityJSON') throw new Error('The document is not CityJSON.');
  if (!Array.isArray(document.vertices)) throw new Error('The vertices array is missing.');
  if (!document.CityObjects || typeof document.CityObjects !== 'object') {
    throw new Error('The CityObjects object is missing.');
  }

  const sourceCrs = parseReferenceSystem(document.metadata?.referenceSystem);
  const transform = document.transform;
  if (transform && (!isFiniteTriple(transform.scale) || !isFiniteTriple(transform.translate))) {
    throw new Error('transform.scale and transform.translate must contain three finite numbers.');
  }

  const vertices = document.vertices.map((vertex, index): Vec3 => {
    if (!isFiniteTriple(vertex)) throw new Error(`Vertex ${index} does not contain three finite numbers.`);
    if (!transform) return [vertex[0], vertex[1], vertex[2]];
    return [
      vertex[0] * transform.scale[0] + transform.translate[0],
      vertex[1] * transform.scale[1] + transform.translate[1],
      vertex[2] * transform.scale[2] + transform.translate[2],
    ];
  });

  for (const [id, object] of Object.entries(document.CityObjects)) {
    if (!object || typeof object !== 'object' || typeof object.type !== 'string') {
      throw new Error(`Object ${id} does not have a valid type.`);
    }
    for (const geometry of object.geometry ?? []) {
      if (!supportedGeometry.has(geometry.type)) continue;
      if (geometry.boundaries === undefined) throw new Error(`The geometry of ${id} has no boundaries.`);
    }
  }

  return { document: document as CityJsonDocument, sourceCrs, vertices };
}

export function surfacesOf(geometry: CityGeometry): number[][][] {
  const b = geometry.boundaries as any;
  switch (geometry.type) {
    case 'MultiSurface':
    case 'CompositeSurface': return Array.isArray(b) ? b : [];
    case 'Solid': return Array.isArray(b) ? b.flat(1) : [];
    case 'MultiSolid':
    case 'CompositeSolid': return Array.isArray(b) ? b.flat(2) : [];
    default: return [];
  }
}

export function linesOf(geometry: CityGeometry): number[][] {
  return geometry.type === 'MultiLineString' && Array.isArray(geometry.boundaries)
    ? geometry.boundaries as number[][]
    : [];
}
