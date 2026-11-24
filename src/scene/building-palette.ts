import * as THREE from 'three';
import type { CityObject } from '../domain/cityjson';

export const BuildingColourMode = Object.freeze({
  CONTRAST: 'contrast',
  TYPE: 'type',
  BUILDING: 'building',
} as const);

export type BuildingColourMode = typeof BuildingColourMode[keyof typeof BuildingColourMode];

export const BuildingPalettePreset = Object.freeze({
  DEFAULT: 'default',
  GREY_BLUE: 'grey-blue',
} as const);

export type BuildingPalettePreset = typeof BuildingPalettePreset[keyof typeof BuildingPalettePreset];

/**
 * Display-only colour policy consumed by the CityJSON scene and style panel.
 * `shuffleSeed` is an integer varied only by an explicit user action. The
 * authoritative default keeps explicit building families together and chooses
 * contrasting colours for nearby source-XY bounds. No field changes source data.
 */
export interface BuildingPaletteSettings {
  mode: BuildingColourMode;
  preset: BuildingPalettePreset;
  shuffleSeed: number;
}

export const DEFAULT_BUILDING_PALETTE_SETTINGS: Readonly<BuildingPaletteSettings> = Object.freeze({
  mode: BuildingColourMode.CONTRAST,
  preset: BuildingPalettePreset.DEFAULT,
  shuffleSeed: 0,
});

/** Source-CRS horizontal bounds in the same units as CityJSON X and Y. */
export interface SourceBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PaletteFeature {
  id: string;
  object: CityObject;
  sourceBounds?: SourceBounds;
  mesh?: THREE.Mesh;
}

export const BUILDING_PALETTES: Readonly<Record<BuildingPalettePreset, readonly number[]>> = Object.freeze({
  [BuildingPalettePreset.DEFAULT]: Object.freeze([
    0xd8e2dc, 0x3a5a78, 0xe9c46a, 0x6d597a,
    0x84a98c, 0xbc4749, 0x90b4ce, 0x7f5539,
    0xcdb4db, 0x2a9d8f, 0xf4a261, 0x4f5d75,
  ]),
  [BuildingPalettePreset.GREY_BLUE]: Object.freeze([
    0xf2f5f7, 0x183b56, 0xaeb8c2, 0x365a73,
    0xd4dce2, 0x526f86, 0x87939e, 0x254b67,
    0xc2cbd2, 0x7297b1, 0x68737d, 0x0d304b,
  ]),
});

export const CITY_OBJECT_TYPE_COLOURS: Readonly<Record<string, number>> = Object.freeze({
  Building: 0xe8c49a,
  BuildingPart: 0xd4a574,
  BuildingInstallation: 0xc8956c,
  Road: 0x7a7a8a,
  Railway: 0x8a8090,
  TransportSquare: 0x9a9aaa,
  WaterBody: 0x4a90d9,
  TINRelief: 0x8f7b62,
  PlantCover: 0x5a8f3c,
  SolitaryVegetationObject: 0x6aaf4c,
  LandUse: 0xb8c896,
  CityFurniture: 0xe87070,
  Bridge: 0x9090a0,
  Tunnel: 0x707080,
  GenericCityObject: 0xaa77cc,
});

export const FALLBACK_CITY_OBJECT_COLOUR = 0x8888aa;

export function validateBuildingPaletteSettings(settings: BuildingPaletteSettings): BuildingPaletteSettings {
  if (!Object.values(BuildingColourMode).includes(settings.mode)) throw new Error(`Unknown building colour mode: ${settings.mode}`);
  if (!Object.values(BuildingPalettePreset).includes(settings.preset)) throw new Error(`Unknown building palette preset: ${settings.preset}`);
  if (!Number.isSafeInteger(settings.shuffleSeed) || settings.shuffleSeed < 0) throw new Error('The palette shuffle seed must be a non-negative safe integer.');
  return { ...settings };
}

export function applyBuildingPalette(features: PaletteFeature[], settings: BuildingPaletteSettings): void {
  const validated = validateBuildingPaletteSettings(settings);
  const objects = Object.fromEntries(features.map(feature => [feature.id, feature.object]));
  const reverseParents = reverseParentIndex(objects);
  const familyBounds = new Map<string, SourceBounds>();
  for (const feature of features) {
    if (!isBuilding(feature.object) || !feature.sourceBounds) continue;
    const key = buildingColourKey(objects, feature.id, reverseParents);
    familyBounds.set(key, mergeBounds(familyBounds.get(key), feature.sourceBounds));
  }
  const palette = BUILDING_PALETTES[validated.preset];
  const assignments = validated.mode === BuildingColourMode.CONTRAST
    ? contrastPaletteAssignments(familyBounds, palette)
    : undefined;

  for (const feature of features) {
    const material = feature.mesh?.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    let colour = CITY_OBJECT_TYPE_COLOURS[feature.object.type] ?? FALLBACK_CITY_OBJECT_COLOUR;
    if (validated.mode !== BuildingColourMode.TYPE && isBuilding(feature.object)) {
      const key = buildingColourKey(objects, feature.id, reverseParents);
      colour = validated.mode === BuildingColourMode.CONTRAST
        ? palette[assignments?.get(key) ?? 0]!
        : new THREE.Color().setHSL(buildingHue(key, validated.shuffleSeed), 0.52, 0.61).getHex();
    }
    material.color.setHex(colour);
  }
}

export function buildingColourKey(objects: Record<string, CityObject>, id: string, reverseParents = reverseParentIndex(objects)): string {
  const seen = new Set<string>();
  const stack = [id];
  const roots: string[] = [];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const object = objects[key];
    if (!object) continue;
    if (object.type === 'Building') roots.push(key);
    else stack.push(...(object.parents ?? []), ...(reverseParents.get(key) ?? []));
  }
  return roots.sort()[0] ?? id;
}

export function contrastPaletteAssignments(
  boundsByKey: ReadonlyMap<string, SourceBounds>,
  palette: readonly number[],
  padding?: number,
): Map<string, number> {
  if (palette.length < 2 || palette.some(colour => !Number.isInteger(colour) || colour < 0 || colour > 0xffffff)) {
    throw new Error('Contrast palette requires at least two valid RGB colours.');
  }
  const records = [...boundsByKey].map(([key, bounds]) => ({ key, ...bounds }));
  const sizes = records.map(record => Math.max(record.maxX - record.minX, record.maxY - record.minY)).filter(size => size > 0).sort((a, b) => a - b);
  const gap = padding ?? (sizes.length ? sizes[Math.floor(sizes.length / 2)]! * 0.15 : 0);
  records.sort((a, b) => a.minX - b.minX || a.minY - b.minY || a.key.localeCompare(b.key));
  const assignments = new Map<string, number>();
  const active: typeof records = [];
  for (const record of records) {
    for (let index = active.length - 1; index >= 0; index -= 1) if (active[index]!.maxX + gap < record.minX) active.splice(index, 1);
    const used = [...new Set(active
      .filter(other => other.minY <= record.maxY + gap && other.maxY + gap >= record.minY)
      .map(other => assignments.get(other.key))
      .filter((index): index is number => index !== undefined))];
    const start = Math.floor(buildingHue(record.key, 0) * palette.length);
    let selected = start;
    let bestDistance = -1;
    for (let offset = 0; offset < palette.length; offset += 1) {
      const candidate = (start + offset) % palette.length;
      const distance = used.length ? Math.min(...used.map(index => colourDistanceSquared(palette[candidate]!, palette[index]!))) : 0;
      if (distance > bestDistance) { bestDistance = distance; selected = candidate; }
    }
    assignments.set(record.key, selected);
    active.push(record);
  }
  return assignments;
}

export function buildingHue(key: string, seed: number): number {
  let hash = 2166136261;
  for (const character of `${seed}:${key}`) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

function reverseParentIndex(objects: Record<string, CityObject>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [parent, object] of Object.entries(objects)) {
    for (const child of object.children ?? []) result.set(child, [...(result.get(child) ?? []), parent]);
  }
  return result;
}

function isBuilding(object: CityObject): boolean {
  return object.type === 'Building' || object.type === 'BuildingPart';
}

function mergeBounds(current: SourceBounds | undefined, next: SourceBounds): SourceBounds {
  if (!current) return { ...next };
  return {
    minX: Math.min(current.minX, next.minX), minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX), maxY: Math.max(current.maxY, next.maxY),
  };
}

function colourDistanceSquared(a: number, b: number): number {
  const ar = a >> 16 & 255; const ag = a >> 8 & 255; const ab = a & 255;
  const br = b >> 16 & 255; const bg = b >> 8 & 255; const bb = b & 255;
  return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
}
