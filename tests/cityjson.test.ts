import { describe, expect, it } from 'vitest';
import { parseCityJson, parseReferenceSystem } from '../src/domain/cityjson';
import { triangulateSurface } from '../src/domain/triangulation';
import { Coordinates } from 'itowns';
import { registerCommonCrs } from '../src/scene/cityjson-layer';
import { assignLayerToGroup, moveLayer, repositionLayer, type LayerGroup } from '../src/domain/layer-catalog';
import { ExternalLayerAuthorizationMode, validateExternalLayerInput } from '../src/map/external-layers';
import { instantiatePreset, layerPresets } from '../src/map/layer-presets';
import { decodeElevationRgb, TerrainEncoding, terrainPresets } from '../src/map/terrain-layers';
import * as THREE from 'three';
import {
  applyBuildingPalette,
  buildingColourKey,
  BuildingColourMode,
  BuildingPalettePreset,
  contrastPaletteAssignments,
  DEFAULT_BUILDING_PALETTE_SETTINGS,
  validateBuildingPaletteSettings,
  type PaletteFeature,
} from '../src/scene/building-palette';

describe('CityJSON contract', () => {
  it('preserves identifiers and applies transform exactly once', () => {
    const parsed = parseCityJson({
      type: 'CityJSON',
      metadata: { referenceSystem: 'https://www.opengis.net/def/crs/EPSG/0/25830' },
      transform: { scale: [0.1, 0.1, 0.01], translate: [400000, 4400000, 600] },
      vertices: [[10, 20, 300]],
      CityObjects: { 'source:id-7': { type: 'Building', attributes: { source: 'test' } } },
    });
    expect(parsed.sourceCrs).toBe('EPSG:25830');
    expect(parsed.vertices[0]).toEqual([400001, 4400002, 603]);
    expect(parsed.document.CityObjects['source:id-7']?.attributes).toEqual({ source: 'test' });
  });

  it('accepts common EPSG reference notations and rejects absence', () => {
    expect(parseReferenceSystem('urn:ogc:def:crs:EPSG::4326')).toBe('EPSG:4326');
    expect(() => parseReferenceSystem(undefined)).toThrow(/referenceSystem/);
  });
});

describe('surface triangulation', () => {
  it('triangulates a vertical quad using the source vertex indices', () => {
    const vertices = [[0, 0, 0], [0, 2, 0], [0, 2, 3], [0, 0, 3]] as const;
    const result = triangulateSurface([[0, 1, 2, 3, 0]], [...vertices]);
    expect(result).toHaveLength(6);
    expect(new Set(result)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('CRS catalogue', () => {
  it('places an EPSG:4083 REGCAN95 control point in ECEF', () => {
    registerCommonCrs('EPSG:4083');
    const ecef = new Coordinates('EPSG:4083', 457013.35, 3112439.18, 70).as('EPSG:4978');
    expect(ecef.x).toBeCloseTo(5425565.593870, 3);
    expect(ecef.y).toBeCloseTo(-1498296.595386, 3);
    expect(ecef.z).toBeCloseTo(2989920.056818, 3);
  });
});

describe('map layer catalogue', () => {
  it('moves layers in the top-to-bottom display order without mutating the input', () => {
    const order = ['top', 'middle', 'bottom'];
    expect(moveLayer(order, 'middle', 'raise')).toEqual(['middle', 'top', 'bottom']);
    expect(moveLayer(order, 'middle', 'lower')).toEqual(['top', 'bottom', 'middle']);
    expect(order).toEqual(['top', 'middle', 'bottom']);
  });

  it('assigns each layer to at most one group', () => {
    const groups: LayerGroup[] = [
      { id: 'context', name: 'Context', visible: true, layerIds: ['ortho'] },
      { id: 'design', name: 'Design', visible: true, layerIds: [] },
    ];
    assignLayerToGroup(groups, 'ortho', 'design');
    expect(groups[0]?.layerIds).toEqual([]);
    expect(groups[1]?.layerIds).toEqual(['ortho']);
  });

  it('repositions a layer before or after another layer without mutating the input', () => {
    const order = ['ortho', 'labels', 'base'];
    expect(repositionLayer(order, 'base', 'ortho', 'before')).toEqual(['base', 'ortho', 'labels']);
    expect(repositionLayer(order, 'ortho', 'base', 'after')).toEqual(['labels', 'base', 'ortho']);
    expect(order).toEqual(['ortho', 'labels', 'base']);
  });
});

describe('external map sources', () => {
  it('requires the WMTS service layer and tile matrix set', () => {
    const base = { id: 'wmts-test', name: 'Test', kind: 'wmts' as const, url: 'https://example.com/wmts' };
    expect(() => validateExternalLayerInput(base)).toThrow(/service layer/i);
    expect(() => validateExternalLayerInput({ ...base, serviceLayer: 'map' })).toThrow(/matrix set/i);
  });

  it('instantiates the IGN and OSM examples with unique runtime IDs', () => {
    expect(layerPresets.map(preset => preset.source.kind)).toEqual(['wmts', 'xyz', 'wmts', 'wmts']);
    expect(instantiatePreset(layerPresets[1]!, 7).id).toBe('preset-osm-standard-7');
    expect(layerPresets[0]?.source.serviceLayer).toBe('BlueMarble_ShadedRelief_Bathymetry');
  });

  it('validates session-only authorization and owns the query parameter default', () => {
    const base = { id: 'private-tiles', name: 'Private', kind: 'xyz' as const, url: 'https://example.com/{z}/{x}/{y}.png' };
    expect(() => validateExternalLayerInput({ ...base, authorization: { mode: ExternalLayerAuthorizationMode.BEARER, token: ' ' } })).toThrow(/token/i);
    expect(validateExternalLayerInput({ ...base, authorization: { mode: ExternalLayerAuthorizationMode.QUERY, token: 'secret' } }).authorization)
      .toEqual({ mode: 'query', token: 'secret', parameter: 'access_token' });
  });
});

describe('terrain sources', () => {
  it('decodes Mapbox and Terrarium RGB elevation values', () => {
    expect(decodeElevationRgb(1, 134, 160, TerrainEncoding.MAPBOX)).toBeCloseTo(0, 6);
    expect(decodeElevationRgb(128, 0, 0, TerrainEncoding.TERRARIUM)).toBe(0);
  });

  it('offers opt-in IGN Spain and global Mapzen terrain presets', () => {
    expect(terrainPresets.map(preset => preset.key)).toEqual(['ign-spain-dem', 'mapzen-global-terrain']);
    expect(terrainPresets[0]?.url).toContain('xyz-mdt.idee.es');
  });
});

describe('building display palettes', () => {
  it('uses explicit parent and reverse-child relationships for one building family', () => {
    const objects = {
      root: { type: 'Building', children: ['part'] },
      part: { type: 'BuildingPart' },
      standalone: { type: 'BuildingPart' },
    };
    expect(buildingColourKey(objects, 'part')).toBe('root');
    expect(buildingColourKey(objects, 'standalone')).toBe('standalone');
  });

  it('separates adjacent families and gives explicit family members one colour', () => {
    const material = () => new THREE.MeshStandardMaterial();
    const features: PaletteFeature[] = [
      { id: 'a', object: { type: 'Building', children: ['a-part'] }, sourceBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, mesh: new THREE.Mesh(new THREE.BufferGeometry(), material()) },
      { id: 'a-part', object: { type: 'BuildingPart' }, sourceBounds: { minX: 1, minY: 1, maxX: 4, maxY: 4 }, mesh: new THREE.Mesh(new THREE.BufferGeometry(), material()) },
      { id: 'b', object: { type: 'Building' }, sourceBounds: { minX: 11, minY: 0, maxX: 20, maxY: 10 }, mesh: new THREE.Mesh(new THREE.BufferGeometry(), material()) },
    ];
    applyBuildingPalette(features, { ...DEFAULT_BUILDING_PALETTE_SETTINGS });
    const colours = features.map(feature => (feature.mesh!.material as THREE.MeshStandardMaterial).color.getHex());
    expect(colours[0]).toBe(colours[1]);
    expect(colours[0]).not.toBe(colours[2]);
  });

  it('validates the closed palette contract and deterministic contrast assignment', () => {
    expect(() => validateBuildingPaletteSettings({ mode: BuildingColourMode.CONTRAST, preset: BuildingPalettePreset.DEFAULT, shuffleSeed: -1 })).toThrow(/seed/);
    const bounds = new Map([
      ['left', { minX: 0, minY: 0, maxX: 10, maxY: 10 }],
      ['right', { minX: 9, minY: 0, maxX: 20, maxY: 10 }],
    ]);
    expect(contrastPaletteAssignments(bounds, [0x000000, 0xffffff]).get('left')).not.toBe(contrastPaletteAssignments(bounds, [0x000000, 0xffffff]).get('right'));
  });
});
