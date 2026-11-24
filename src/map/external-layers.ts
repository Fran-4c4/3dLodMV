import { ColorLayer, TMSSource, WMSSource, WMTSSource, type GlobeView } from 'itowns';
import * as THREE from 'three';

/** Protocol adapter selected for an externally hosted raster source. */
export type ExternalLayerKind = 'xyz' | 'wms' | 'wmts';

export const ExternalLayerAuthorizationMode = Object.freeze({
  BEARER: 'bearer',
  QUERY: 'query',
} as const);

export type ExternalLayerAuthorizationMode = typeof ExternalLayerAuthorizationMode[keyof typeof ExternalLayerAuthorizationMode];

/**
 * Session-only credentials consumed directly by the raster source fetcher.
 * Tokens are never persisted, exported, logged or added to attribution. Query
 * mode places the token in each request URL; bearer mode sends an Authorization
 * header and therefore requires provider CORS support for that header.
 */
export interface ExternalLayerAuthorization {
  mode: ExternalLayerAuthorizationMode;
  token: string;
  /** Query key used only in query mode. The authoritative default is `access_token`. */
  parameter?: string;
}

export interface ExternalLayerInput {
  /** Stable identifier used by iTowns and the layer panel. */
  id: string;
  /** Human-readable layer title. */
  name: string;
  /** Adapter contract: tiled XYZ/TMS URL or OGC WMS/WMTS endpoint. */
  kind: ExternalLayerKind;
  /** HTTP(S) endpoint. Embedded credentials are rejected. */
  url: string;
  /** OGC layer identifier. Required for WMS and WMTS. */
  serviceLayer?: string;
  /** WMTS tile matrix set identifier. Required only when kind is `wmts`. */
  tileMatrixSet?: string;
  /** OGC style identifier. Empty means the WMS default; WMTS defaults to `default`. */
  style?: string;
  /** Requested image MIME type. Defaults authoritatively to `image/png`. */
  format?: 'image/png' | 'image/jpeg';
  /** Horizontal CRS requested from the service. Defaults authoritatively to EPSG:3857. */
  crs?: 'EPSG:3857' | 'EPSG:4326';
  /** Provider credit retained with the layer and passed to iTowns. */
  attribution?: { name: string; url?: string };
  /** Optional credentials retained in memory only for this browser session. */
  authorization?: ExternalLayerAuthorization;
}

export interface ExternalLayerRecord {
  input: ExternalLayerInput;
  layer: ColorLayer;
}

export async function addExternalLayer(view: GlobeView, input: ExternalLayerInput): Promise<ExternalLayerRecord> {
  const normalized = validateExternalLayerInput(input);
  const request = authenticatedRequest(normalized.url, normalized.authorization);
  const requestOptions = normalized.authorization?.mode === ExternalLayerAuthorizationMode.BEARER
    ? { networkOptions: request.networkOptions, fetcher: authenticatedTextureFetcher }
    : {};
  const source = normalized.kind === 'xyz'
    ? new TMSSource({
      url: normalizeTemplate(request.url),
      crs: normalized.crs ?? 'EPSG:3857',
      format: normalized.format ?? 'image/png',
      attribution: normalized.attribution ?? { name: normalized.name },
      ...requestOptions,
    })
    : normalized.kind === 'wms' ? new WMSSource({
      url: request.url,
      name: normalized.serviceLayer!,
      crs: normalized.crs ?? 'EPSG:3857',
      format: normalized.format ?? 'image/png',
      style: normalized.style ?? '',
      transparent: true,
      version: '1.3.0',
      attribution: normalized.attribution ?? { name: normalized.name },
      ...requestOptions,
    }) : new WMTSSource({
      url: request.url,
      name: normalized.serviceLayer!,
      crs: normalized.crs ?? 'EPSG:3857',
      format: normalized.format ?? 'image/png',
      style: normalized.style || 'default',
      tileMatrixSet: normalized.tileMatrixSet!,
      attribution: normalized.attribution ?? { name: normalized.name },
      ...requestOptions,
    });
  const layer = new ColorLayer(normalized.id, { source });
  await view.addLayer(layer);
  return { input: normalized, layer };
}

export function validateExternalLayerInput(input: ExternalLayerInput): ExternalLayerInput {
  if (!/^[a-z][a-z0-9_-]*$/i.test(input.id)) throw new Error('The ID may only contain letters, numbers, hyphens and underscores.');
  if (!input.name.trim()) throw new Error('The layer needs a name.');
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error('The layer URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) layers are supported.');
  if (url.username || url.password) throw new Error('Do not embed credentials in the URL.');
  if (input.kind === 'xyz' && !(/\{z\}|\$\{z\}/.test(input.url) && /\{x\}|\$\{x\}/.test(input.url) && /\{y\}|\$\{y\}/.test(input.url))) {
    throw new Error('The XYZ template must contain {z}, {x} and {y}.');
  }
  if ((input.kind === 'wms' || input.kind === 'wmts') && !input.serviceLayer?.trim()) {
    throw new Error(`${input.kind.toUpperCase()} needs a service layer identifier.`);
  }
  if (input.kind === 'wmts' && !input.tileMatrixSet?.trim()) throw new Error('WMTS needs a tile matrix set identifier.');
  if (input.authorization) {
    if (!Object.values(ExternalLayerAuthorizationMode).includes(input.authorization.mode)) throw new Error('The authorization mode is invalid.');
    if (!input.authorization.token.trim()) throw new Error('Authorization requires a token.');
    if (input.authorization.mode === ExternalLayerAuthorizationMode.QUERY && input.authorization.parameter && !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(input.authorization.parameter)) {
      throw new Error('The token query parameter is invalid.');
    }
  }
  return {
    ...input,
    name: input.name.trim(),
    url: input.url.trim(),
    serviceLayer: input.serviceLayer?.trim(),
    tileMatrixSet: input.tileMatrixSet?.trim(),
    style: input.style?.trim(),
    authorization: input.authorization ? {
      mode: input.authorization.mode,
      token: input.authorization.token.trim(),
      parameter: input.authorization.mode === ExternalLayerAuthorizationMode.QUERY
        ? input.authorization.parameter?.trim() || 'access_token'
        : undefined,
    } : undefined,
  };
}

function normalizeTemplate(url: string): string {
  return url.replace(/\{([zxy])\}/g, '${$1}');
}

function authenticatedRequest(url: string, authorization?: ExternalLayerAuthorization): { url: string; networkOptions?: RequestInit } {
  if (!authorization) return { url };
  if (authorization.mode === ExternalLayerAuthorizationMode.QUERY) {
    const separator = url.includes('?') ? '&' : '?';
    return { url: `${url}${separator}${encodeURIComponent(authorization.parameter ?? 'access_token')}=${encodeURIComponent(authorization.token)}` };
  }
  return { url, networkOptions: { mode: 'cors', headers: { Authorization: `Bearer ${authorization.token}` } } };
}

async function authenticatedTextureFetcher(url: string, options: RequestInit = {}): Promise<THREE.Texture> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`The authenticated tile request failed with HTTP ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  const texture = new THREE.Texture(bitmap);
  texture.needsUpdate = true;
  return texture;
}
