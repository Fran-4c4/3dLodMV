import type { ExternalLayerInput } from './external-layers';

export interface LayerPreset {
  /** Stable UI key; not reused as the runtime iTowns layer ID. */
  key: string;
  /** User-facing provider/product label. */
  name: string;
  /** Short description shown before the user activates the network source. */
  description: string;
  /** Protocol and source parameters, excluding the per-instance runtime ID. */
  source: Omit<ExternalLayerInput, 'id'>;
}

export const layerPresets: readonly LayerPreset[] = [
  {
    key: 'nasa-blue-marble',
    name: 'NASA Blue Marble',
    description: 'Global shaded relief and bathymetry · default WMTS',
    source: {
      name: 'NASA Blue Marble',
      kind: 'wmts',
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?',
      serviceLayer: 'BlueMarble_ShadedRelief_Bathymetry',
      tileMatrixSet: '500m',
      style: 'default',
      crs: 'EPSG:4326',
      format: 'image/jpeg',
      attribution: { name: 'NASA GIBS · Blue Marble', url: 'https://earthdata.nasa.gov/gibs' },
    },
  },
  {
    key: 'osm-standard',
    name: 'OpenStreetMap Standard',
    description: 'Global community basemap · XYZ',
    source: {
      name: 'OpenStreetMap Standard',
      kind: 'xyz',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      crs: 'EPSG:3857',
      format: 'image/png',
      attribution: { name: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
    },
  },
  {
    key: 'ign-base',
    name: 'IGN Base Map',
    description: 'Spanish National Geographic Institute · WMTS',
    source: {
      name: 'IGN Base Map',
      kind: 'wmts',
      url: 'https://www.ign.es/wmts/ign-base',
      serviceLayer: 'IGNBaseTodo',
      tileMatrixSet: 'GoogleMapsCompatible',
      style: 'default',
      crs: 'EPSG:3857',
      format: 'image/jpeg',
      attribution: { name: '© Instituto Geográfico Nacional', url: 'https://www.ign.es/' },
    },
  },
  {
    key: 'ign-pnoa',
    name: 'PNOA Latest Orthophoto',
    description: 'Latest official orthophotography for Spain · WMTS',
    source: {
      name: 'PNOA Latest Orthophoto',
      kind: 'wmts',
      url: 'https://www.ign.es/wmts/pnoa-ma',
      serviceLayer: 'OI.OrthoimageCoverage',
      tileMatrixSet: 'GoogleMapsCompatible',
      style: 'default',
      crs: 'EPSG:3857',
      format: 'image/jpeg',
      attribution: { name: 'PNOA · © Instituto Geográfico Nacional', url: 'https://pnoa.ign.es/' },
    },
  },
] as const;

export function instantiatePreset(preset: LayerPreset, instance: number): ExternalLayerInput {
  return { ...preset.source, id: `preset-${preset.key}-${instance}` };
}
