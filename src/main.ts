import './styles.css';
import 'toastify-js/src/toastify.css';
import Toastify from 'toastify-js';
import { ColorLayersOrdering, Coordinates, GlobeView } from 'itowns';
import * as THREE from 'three';
import { parseCityJson } from './domain/cityjson';
import { addExternalLayer, ExternalLayerAuthorizationMode, type ExternalLayerRecord } from './map/external-layers';
import { instantiatePreset, layerPresets } from './map/layer-presets';
import { addLocalCogTerrain, addTerrainPreset, terrainPresets, type TerrainRecord } from './map/terrain-layers';
import { assignLayerToGroup, moveLayer, repositionLayer, type LayerDropPlacement, type LayerGroup, type LayerMove } from './domain/layer-catalog';
import {
  applyBuildingPalette,
  BUILDING_PALETTES,
  BuildingColourMode,
  BuildingPalettePreset,
  DEFAULT_BUILDING_PALETTE_SETTINGS,
  type BuildingPaletteSettings,
} from './scene/building-palette';
import {
  buildCityModel,
  setFeatureSelected,
  setModelWireframe,
  type CityModel,
  type FeatureRecord,
} from './scene/cityjson-layer';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="workspace">
    <input id="cityjson-file" type="file" accept=".json,.city.json,application/json" hidden>
    <input id="terrain-file" type="file" accept=".tif,.tiff,image/tiff" hidden>
    <div class="brand floating-brand" aria-label="3dLodMV"><span class="brand-mark">3D</span><span>LOD<strong>MV</strong></span></div>
    <section id="viewer" aria-label="3D globe"></section>
    <div id="map-attribution" class="map-attribution" aria-label="Map attribution" hidden></div>
    <div id="tooltip" class="tooltip" hidden></div>
    <div id="loading-overlay" class="loading-overlay" role="status" aria-live="polite" hidden>
      <div class="loading-card"><span class="loading-spinner" aria-hidden="true"></span><div><strong id="loading-title">Loading data</strong><span id="loading-stage">Preparing…</span></div><progress id="loading-progress" max="100"></progress></div>
    </div>
    <div id="coordinate-menu" class="context-menu" role="menu" hidden><button id="copy-object-coordinates" role="menuitem">Coordinates</button><button id="measure-from-coordinate" role="menuitem">Measure from here</button></div>
    <nav class="map-rail map-rail-left" aria-label="Map panels"><button id="toggle-layers" class="rail-button active" aria-expanded="true" aria-controls="layer-panel" title="Show or hide layers"><span aria-hidden="true">▱</span><small>Layers</small></button></nav>
    <aside id="layer-panel" class="layer-panel">
      <header class="side-heading"><div><span class="eyebrow">Map contents</span><h2>Layers</h2></div><div class="heading-actions"><span id="layer-count" class="badge">0</span><button id="close-layers" class="panel-close" aria-label="Close layers">×</button></div></header>
      <div class="layer-toolbar">
        <button id="open-data-left" class="button primary">Add data</button>
        <button id="new-layer-group" class="button">New group</button>
      </div>
      <section class="terrain-catalog"><header><strong>Terrain</strong><span id="terrain-count" class="group-count">0</span></header><div id="terrain-layer-list" class="group-empty">No terrain loaded.</div></section>
      <div id="scene-layer-list" class="scene-layer-list empty-state">Add a CityJSON model or map source to build the scene.</div>
    </aside>
    <nav id="analysis-tabs" class="analysis-tabs map-rail map-rail-right" aria-label="Map tools" role="tablist">
      <button class="tab" data-panel="objects" title="Objects" aria-expanded="false"><span class="tab-icon" aria-hidden="true">◇</span><small>Objects</small></button>
      <button class="tab" data-panel="inspector" title="Inspector" aria-expanded="false"><span class="tab-icon" aria-hidden="true">ⓘ</span><small>Info</small></button>
      <button class="tab" data-panel="stats" title="Statistics" aria-expanded="false"><span class="tab-icon" aria-hidden="true">▥</span><small>Data</small></button>
      <button class="tab" data-panel="style" title="Style" aria-expanded="false"><span class="tab-icon" aria-hidden="true">◐</span><small>Style</small></button>
      <button class="tab" data-panel="views" title="Views" aria-expanded="false"><span class="tab-icon" aria-hidden="true">◉</span><small>Views</small></button>
      <button class="tab" data-panel="measure" title="Measure" aria-expanded="false"><span class="tab-icon" aria-hidden="true">↔</span><small>Measure</small></button>
    </nav>
    <aside id="analysis" class="analysis closed">
      <div id="analysis-resizer" class="analysis-resizer" role="separator" aria-orientation="vertical" aria-label="Resize analysis panel" tabindex="0"></div>
      <button id="close-analysis" class="panel-close analysis-close" aria-label="Close analysis panel">×</button>
      <div class="analysis-content">
        <section class="panel active" data-panel-content="objects">
          <div class="panel-heading"><div><span class="eyebrow">CityJSON</span><h2>Objects</h2></div><span id="object-count" class="badge">0</span></div>
          <label class="search-box"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"></circle><path d="m15 15 5 5"></path></svg><input id="object-search" class="search" type="search" placeholder="Search by ID or type…" aria-label="Search objects"></label>
          <div id="object-list" class="object-list empty-state">Load a model to explore its objects.</div>
        </section>
        <section class="panel" data-panel-content="inspector">
          <div class="panel-heading"><div><span class="eyebrow">Selection</span><h2>Inspector</h2></div></div>
          <div id="inspector" class="empty-state">Select an object on the map or in the list.</div>
        </section>
        <section class="panel" data-panel-content="stats">
          <div class="panel-heading"><div><span class="eyebrow">Analysis</span><h2>Statistics</h2></div></div>
          <div id="stats" class="empty-state">Metrics appear after loading a CityJSON file.</div>
        </section>
        <section class="panel" data-panel-content="style">
          <div class="panel-heading"><div><span class="eyebrow">Appearance</span><h2>Building colours</h2></div></div>
          <label class="control-label">Colour mode
            <select id="colour-mode" class="control-select">
              <option value="${BuildingColourMode.CONTRAST}">Contrast by building</option>
              <option value="${BuildingColourMode.TYPE}">By object type</option>
              <option value="${BuildingColourMode.BUILDING}">Random by building</option>
            </select>
          </label>
          <label class="control-label">Contrast palette
            <select id="palette-preset" class="control-select">
              <option value="${BuildingPalettePreset.DEFAULT}">Default colours</option>
              <option value="${BuildingPalettePreset.GREY_BLUE}">Greys and blues</option>
            </select>
          </label>
          <div id="palette-swatches" class="palette-swatches" aria-label="Building palette colours"></div>
          <button id="shuffle-colours" class="button full">Shuffle building colours</button>
          <p class="form-note">Building parts inherit their explicit Building family colour. Nearby families receive strongly separated tones.</p>
        </section>
        <section class="panel" data-panel-content="views">
          <div class="panel-heading"><div><span class="eyebrow">Navigation</span><h2>Views</h2></div></div>
          <p class="panel-note">View from the selected direction towards the model. North follows the local geodetic frame.</p>
          <div id="compass-grid" class="compass-grid">
            <button data-bearing="315">NW</button><button data-bearing="0">N</button><button data-bearing="45">NE</button>
            <button data-bearing="270">W</button><button id="view-top">Top</button><button data-bearing="90">E</button>
            <button data-bearing="225">SW</button><button data-bearing="180">S</button><button data-bearing="135">SE</button>
          </div>
          <button id="fit-model" class="button primary full" disabled>Fit model</button>
          <button id="save-view" class="button full" disabled>Save current view</button>
          <div id="saved-views" class="saved-views empty-state">Saved views last until the page is reloaded.</div>
          <div class="option-row"><div><strong>Wireframe</strong><small>Inspect triangulation</small></div><input id="wireframe" type="checkbox" disabled></div>
          <div class="warning"><strong>Vertical reference</strong><span>Z is used as supplied. The vertical datum is not transformed and buildings are not clamped to terrain.</span></div>
        </section>
        <section class="panel" data-panel-content="measure">
          <div class="panel-heading"><div><span class="eyebrow">Map tool</span><h2>Measure</h2></div></div>
          <p class="panel-note">Click points on the globe, terrain or model. Horizontal distance is an approximate WGS84 geodesic; 3D distance is the ECEF polyline and includes supplied elevation.</p>
          <div class="measurement-actions"><button id="toggle-measurement" class="button primary">Start measuring</button><button id="clear-measurement" class="button">Clear</button></div>
          <div id="measurement-readout" class="measurement-readout"><div><span>Points</span><strong>0</strong></div><div><span>Horizontal</span><strong>0 m</strong></div><div><span>3D</span><strong>0 m</strong></div></div>
          <p class="form-note">No vertical datum conversion is performed. Do not interpret the 3D result as a surveyed distance when source Z is unknown.</p>
        </section>
      </div>
    </aside>
  </main>
  <div id="data-modal" class="modal-overlay" hidden>
    <section class="data-modal" role="dialog" aria-modal="true" aria-labelledby="data-modal-title">
      <header class="modal-header">
        <div><span class="eyebrow">Data sources</span><h1 id="data-modal-title">Add data to map</h1></div>
        <button id="close-data-modal" class="modal-close" title="Close" aria-label="Close add data dialog">×</button>
      </header>
      <p class="modal-intro">Choose a source. Local files stay in this browser and are never uploaded.</p>
      <div id="source-picker">
        <div class="source-grid">
          <button id="open-file" class="source-card available">
            <span class="source-icon">CJ</span><span class="source-copy"><strong>CityJSON file</strong><small>Open .json or .city.json from this device</small></span><span class="source-state">Available</span>
          </button>
          <button class="source-card available configure-layer" data-kind="xyz">
            <span class="source-icon">XYZ</span><span class="source-copy"><strong>Raster tiles</strong><small>Configure an XYZ or TMS tile template</small></span><span class="source-state">Available</span>
          </button>
          <button class="source-card available configure-layer" data-kind="wms">
            <span class="source-icon">WMS</span><span class="source-copy"><strong>WMS service</strong><small>Add an OGC WMS 1.3.0 layer</small></span><span class="source-state">Available</span>
          </button>
          <button class="source-card available configure-layer" data-kind="wmts">
            <span class="source-icon">WMTS</span><span class="source-copy"><strong>WMTS service</strong><small>Add an OGC WMTS 1.0.0 tiled layer</small></span><span class="source-state">Available</span>
          </button>
          <button id="load-demo" class="source-card available">
            <span class="source-icon">EX</span><span class="source-copy"><strong>Example dataset</strong><small>Load the bundled two-building CityJSON</small></span><span class="source-state">Available</span>
          </button>
          <button id="open-terrain-file" class="source-card available">
            <span class="source-icon">DEM</span><span class="source-copy"><strong>Local terrain / DTM</strong><small>Open a north-up COG or GeoTIFF from this device</small></span><span class="source-state">Available</span>
          </button>
          <button class="source-card" disabled>
            <span class="source-icon">3D</span><span class="source-copy"><strong>3D Tiles</strong><small>Stream a hierarchical tileset</small></span><span class="source-state planned">Planned</span>
          </button>
        </div>
        <section class="preset-section"><span class="eyebrow">Example layers</span><div id="preset-list" class="preset-list"></div></section>
        <section class="preset-section"><span class="eyebrow">Terrain sources</span><p class="preset-help">Terrain is never loaded by default and never clamps CityJSON buildings.</p><div id="terrain-preset-list" class="preset-list"></div></section>
      </div>
      <div id="source-config" class="source-config" hidden>
        <button id="back-to-sources" class="text-button" type="button">Back to sources</button>
        <form id="external-layer-form">
          <input name="kind" type="hidden" value="xyz">
          <div class="config-heading"><span class="eyebrow">Map source</span><h2 id="source-config-title">Configure raster tiles</h2></div>
          <label>Name<input name="name" required></label>
          <label>Service URL<input name="url" required></label>
          <label class="service-layer-field" hidden>Layer identifier<input name="serviceLayer"></label>
          <label class="wmts-only" hidden>Tile matrix set<input name="tileMatrixSet" value="GoogleMapsCompatible"></label>
          <label class="ogc-only" hidden>Style<input name="style" value="default"></label>
          <div class="form-columns">
            <label>CRS<select name="crs"><option>EPSG:3857</option><option>EPSG:4326</option></select></label>
            <label>Image format<select name="format"><option>image/png</option><option>image/jpeg</option></select></label>
          </div>
          <label>Authorization<select id="authorization-mode" name="authorizationMode"><option value="">None</option><option value="${ExternalLayerAuthorizationMode.BEARER}">Bearer token header</option><option value="${ExternalLayerAuthorizationMode.QUERY}">Token query parameter</option></select></label>
          <div id="authorization-fields" hidden>
            <label>Token<input name="authorizationToken" type="password" autocomplete="off" spellcheck="false"></label>
            <label id="authorization-parameter-field" hidden>Query parameter<input name="authorizationParameter" value="access_token"></label>
            <p class="form-note">Used only for requests in this session. It is not saved, exported or shown in the layer catalogue.</p>
          </div>
          <div class="form-columns">
            <label>Attribution name<input name="attributionName" placeholder="© Data provider"></label>
            <label>Attribution URL<input name="attributionUrl" type="url" placeholder="https://…"></label>
          </div>
          <button class="button primary full" type="submit">Add layer</button>
          <p class="form-note">Requests go directly to the provider. Check CORS, licensing and attribution.</p>
        </form>
      </div>
      <footer class="modal-footer"><span>CityJSON files are parsed in memory. Browser memory limits the maximum file size.</span></footer>
    </section>
  </div>`;

const viewerElement = element<HTMLDivElement>('viewer');
const tooltip = element<HTMLDivElement>('tooltip');
const view = new GlobeView(viewerElement, {
  coord: new Coordinates('EPSG:4326', -3.7, 40.4, 0),
  range: 12_000_000,
  tilt: 25,
});
const measurementRoot = new THREE.Group(); measurementRoot.name = 'Measurements'; view.scene.add(measurementRoot);

let model: CityModel | undefined;
let selected: FeatureRecord | undefined;
const externalLayers: ExternalLayerRecord[] = [];
let terrain: TerrainRecord | undefined;
const layerGroups: LayerGroup[] = [];
const layerVisibility = new Map<string, boolean>();
let layerDisplayOrder: string[] = [];
let groupCounter = 0;
let sourceInstance = 0;
let paletteSettings: BuildingPaletteSettings = { ...DEFAULT_BUILDING_PALETTE_SETTINGS };
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const savedViews: Array<{ name: string; position: THREE.Vector3; quaternion: THREE.Quaternion }> = [];
const measurementPoints: THREE.Vector3[] = [];
let measurementActive = false;

setupUi();
void addDefaultBaseMap();
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__3dLodMVDebug', { value: { view, get model() { return model; }, get layerOrder() { return [...layerDisplayOrder]; } } });
}

function setupUi(): void {
  element<HTMLButtonElement>('open-data-left').addEventListener('click', openDataModal);
  element<HTMLButtonElement>('new-layer-group').addEventListener('click', createLayerGroup);
  element<HTMLButtonElement>('close-data-modal').addEventListener('click', closeDataModal);
  element<HTMLButtonElement>('back-to-sources').addEventListener('click', showSourcePicker);
  element<HTMLButtonElement>('open-file').addEventListener('click', () => element<HTMLInputElement>('cityjson-file').click());
  element<HTMLButtonElement>('open-terrain-file').addEventListener('click', () => element<HTMLInputElement>('terrain-file').click());
  element<HTMLInputElement>('cityjson-file').addEventListener('change', event => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) { closeDataModal(); void loadFile(file); }
  });
  element<HTMLInputElement>('terrain-file').addEventListener('change', event => {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0];
    if (file) { closeDataModal(); void loadLocalTerrain(file); }
    input.value = '';
  });
  element<HTMLButtonElement>('load-demo').addEventListener('click', async () => {
    closeDataModal();
    await runLoad('bundled example', async () => (await fetch('/examples/demo.city.json')).json());
  });
  element('data-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeDataModal();
  });
  document.querySelectorAll<HTMLButtonElement>('.configure-layer').forEach(button => button.addEventListener('click', () => {
    showSourceConfig(button.dataset.kind as 'xyz' | 'wms' | 'wmts');
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeDataModal(); hideCoordinateMenu(); }
  });
  element<HTMLButtonElement>('toggle-layers').addEventListener('click', toggleLayersPanel);
  element<HTMLButtonElement>('close-layers').addEventListener('click', closeLayersPanel);
  element<HTMLButtonElement>('close-analysis').addEventListener('click', closeAnalysisPanel);
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => tab.addEventListener('click', () => toggleAnalysisPanel(tab.dataset.panel!)));
  element<HTMLInputElement>('object-search').addEventListener('input', renderObjectList);
  element<HTMLInputElement>('wireframe').addEventListener('change', event => {
    if (model) { setModelWireframe(model, (event.currentTarget as HTMLInputElement).checked); view.notifyChange(model.root); }
  });
  element<HTMLButtonElement>('fit-model').addEventListener('click', () => { void fitModel(); });
  element<HTMLButtonElement>('save-view').addEventListener('click', saveCurrentView);
  element<HTMLButtonElement>('toggle-measurement').addEventListener('click', () => setMeasurementActive(!measurementActive));
  element<HTMLButtonElement>('clear-measurement').addEventListener('click', clearMeasurement);
  document.querySelectorAll<HTMLButtonElement>('[data-bearing]').forEach(button => button.addEventListener('click', () => setCardinalView(Number(button.dataset.bearing))));
  element<HTMLButtonElement>('view-top').addEventListener('click', setTopView);
  element<HTMLSelectElement>('colour-mode').addEventListener('change', event => {
    paletteSettings = { ...paletteSettings, mode: (event.currentTarget as HTMLSelectElement).value as BuildingPaletteSettings['mode'] };
    applyCurrentPalette();
  });
  element<HTMLSelectElement>('palette-preset').addEventListener('change', event => {
    paletteSettings = { ...paletteSettings, preset: (event.currentTarget as HTMLSelectElement).value as BuildingPaletteSettings['preset'] };
    applyCurrentPalette(); renderPaletteControls();
  });
  element<HTMLButtonElement>('shuffle-colours').addEventListener('click', () => {
    paletteSettings = { ...paletteSettings, mode: BuildingColourMode.BUILDING, shuffleSeed: paletteSettings.shuffleSeed + 1 };
    applyCurrentPalette(); renderPaletteControls();
  });

  const form = element<HTMLFormElement>('external-layer-form');
  form.addEventListener('submit', event => { event.preventDefault(); void submitExternalLayer(form); });
  element<HTMLSelectElement>('authorization-mode').addEventListener('change', updateAuthorizationFields);
  renderLayerPresets();
  renderTerrainPresets();
  renderLayerCatalog();
  renderTerrainCatalog();
  renderPaletteControls();
  setupAnalysisResizer();

  // File drops are deliberately disabled. Capturing both events prevents the
  // browser from navigating to a dropped CityJSON anywhere in the window.
  window.addEventListener('dragover', blockFileNavigation, true);
  window.addEventListener('drop', blockFileNavigation, true);
  viewerElement.addEventListener('pointermove', handlePointerMove);
  viewerElement.addEventListener('click', event => {
    if (measurementActive) {
      const feature = pickFeature(event); addMeasurementPoint(pickScenePosition(event) ?? (feature ? featureWorldCentre(feature) : undefined)); return;
    }
    const hit = pickFeature(event); if (hit) selectFeature(hit);
  });
  viewerElement.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('pointerdown', event => { if (!element('coordinate-menu').contains(event.target as Node)) hideCoordinateMenu(); });
}

function openDataModal(): void {
  showSourcePicker();
  const modal = element<HTMLElement>('data-modal'); modal.hidden = false;
  element<HTMLButtonElement>('open-file').focus();
}

function closeDataModal(): void {
  element<HTMLElement>('data-modal').hidden = true;
}

function showSourcePicker(): void {
  element<HTMLElement>('source-picker').hidden = false;
  element<HTMLElement>('source-config').hidden = true;
  element('data-modal-title').textContent = 'Add data to map';
}

function showSourceConfig(kind: 'xyz' | 'wms' | 'wmts'): void {
  const form = element<HTMLFormElement>('external-layer-form');
  form.reset();
  (form.elements.namedItem('kind') as HTMLInputElement).value = kind;
  form.querySelector<HTMLElement>('.service-layer-field')!.hidden = kind === 'xyz';
  form.querySelector<HTMLElement>('.wmts-only')!.hidden = kind !== 'wmts';
  form.querySelector<HTMLElement>('.ogc-only')!.hidden = kind === 'xyz';
  updateAuthorizationFields();
  element('source-config-title').textContent = kind === 'xyz' ? 'Configure raster tiles' : `Configure ${kind.toUpperCase()} service`;
  element('data-modal-title').textContent = 'Configure map source';
  element<HTMLElement>('source-picker').hidden = true;
  element<HTMLElement>('source-config').hidden = false;
  (form.elements.namedItem('name') as HTMLInputElement).focus();
}

function updateAuthorizationFields(): void {
  const form = element<HTMLFormElement>('external-layer-form');
  const mode = (form.elements.namedItem('authorizationMode') as HTMLSelectElement).value;
  element<HTMLElement>('authorization-fields').hidden = !mode;
  element<HTMLElement>('authorization-parameter-field').hidden = mode !== ExternalLayerAuthorizationMode.QUERY;
}

function renderLayerPresets(): void {
  const target = element('preset-list');
  target.replaceChildren();
  for (const preset of layerPresets) {
    const button = document.createElement('button');
    button.className = 'preset-card';
    const copy = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = preset.name;
    const description = document.createElement('small'); description.textContent = preset.description;
    const action = document.createElement('span'); action.className = 'preset-action'; action.textContent = 'Add';
    copy.append(title, description); button.append(copy, action);
    button.addEventListener('click', () => { void addMapSource(instantiatePreset(preset, ++sourceInstance)); });
    target.append(button);
  }
}

function renderTerrainPresets(): void {
  const target = element('terrain-preset-list'); target.replaceChildren();
  for (const preset of terrainPresets) {
    const button = document.createElement('button'); button.className = 'preset-card';
    const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = preset.name;
    const description = document.createElement('small'); description.textContent = preset.description;
    const action = document.createElement('span'); action.className = 'preset-action'; action.textContent = 'Add';
    copy.append(title, description); button.append(copy, action);
    button.addEventListener('click', () => { closeDataModal(); void loadTerrainPreset(preset); }); target.append(button);
  }
}

function blockFileNavigation(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'none';
}

async function loadFile(file: File): Promise<void> {
  await runLoad(file.name, async () => JSON.parse(await readFileText(file)) as unknown);
}

async function runLoad(label: string, loader: () => Promise<unknown>): Promise<void> {
  setStatus(`Loading ${label}…`, 'working');
  setLoading(label, 'Reading source…', 5);
  try {
    await nextPaint();
    const raw = await loader();
    setLoading(label, 'Validating CityJSON…', 38); await nextPaint();
    const parsed = parseCityJson(raw);
    setLoading(label, 'Building 3D geometry…', 58); await nextPaint();
    const nextModel = buildCityModel(parsed);
    applyBuildingPalette(nextModel.features, paletteSettings);
    setLoading(label, 'Adding model to the globe…', 82); await nextPaint();
    if (model) view.removeLayer(model.layer.id, true);
    model = nextModel; selected = undefined;
    await view.addLayer(model.layer);
    if (!layerDisplayOrder.includes(model.layer.id)) layerDisplayOrder.unshift(model.layer.id);
    layerVisibility.set(model.layer.id, true);
    raycaster.params.Line!.threshold = Math.max(0.5, model.radius * 0.003);
    renderAll();
    setLoading(label, 'Framing the model…', 94); await nextPaint();
    await fitModel();
    setStatus(`${label} · ${model.features.length.toLocaleString('en-US')} objects · ${model.drawableFeatureCount.toLocaleString('en-US')} visible · ${model.sourceCrs}`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'The file could not be loaded.', 'error');
  } finally { hideLoading(); }
}

async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => { if (event.lengthComputable) setLoading(file.name, 'Reading local file…', 5 + event.loaded / event.total * 28); };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.onload = () => resolve(String(reader.result)); reader.readAsText(file);
  });
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => { if (event.lengthComputable) setLoading(file.name, 'Reading local terrain…', 5 + event.loaded / event.total * 35); };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(file);
  });
}

async function loadLocalTerrain(file: File): Promise<void> {
  setStatus(`Loading terrain ${file.name}…`, 'working'); setLoading(file.name, 'Reading local terrain…', 5);
  try {
    const buffer = await readFileBuffer(file); setLoading(file.name, 'Decoding and resampling COG…', 48); await nextPaint();
    const next = await addLocalCogTerrain(view, buffer, file.name); setLoading(file.name, 'Applying terrain elevations…', 90);
    replaceTerrain(next); setStatus(`${file.name} terrain added. Buildings remain at their supplied Z.`, 'success');
  } catch (error) { setStatus(error instanceof Error ? error.message : 'The terrain could not be loaded.', 'error'); }
  finally { hideLoading(); }
}

async function loadTerrainPreset(preset: (typeof terrainPresets)[number]): Promise<void> {
  setStatus(`Adding ${preset.name}…`, 'working'); setLoading(preset.name, 'Configuring terrain tiles…', 25);
  try {
    const centre = model
      ? new Coordinates('EPSG:4978', model.center.x, model.center.y, model.center.z)
      : view.controls!.getLookAtCoordinate();
    setLoading(preset.name, 'Downloading the terrain patch…', 45);
    const next = await addTerrainPreset(view, preset, ++sourceInstance, centre); setLoading(preset.name, 'Activating terrain…', 88);
    replaceTerrain(next); setStatus(`${preset.name} patch added around the current area.`, 'success');
  } catch (error) { setStatus(error instanceof Error ? error.message : 'The terrain source could not be added.', 'error'); }
  finally { hideLoading(); }
}

function replaceTerrain(next: TerrainRecord): void {
  if (terrain) view.removeLayer(terrain.layer.id, true);
  terrain = next; renderTerrainCatalog(); renderMapAttribution(); view.notifyChange(view.tileLayer);
}

function setLoading(title: string, stage: string, percent?: number): void {
  const overlay = element<HTMLElement>('loading-overlay'); overlay.hidden = false;
  element('loading-title').textContent = title; element('loading-stage').textContent = stage;
  const progress = element<HTMLProgressElement>('loading-progress');
  if (percent === undefined) progress.removeAttribute('value'); else progress.value = percent;
}

function hideLoading(): void { element<HTMLElement>('loading-overlay').hidden = true; }

function nextPaint(): Promise<void> { return new Promise(resolve => requestAnimationFrame(() => resolve())); }

async function fitModel(): Promise<void> {
  if (!model) return;
  // Keep iTowns' internal control target synchronized with the camera. Direct
  // camera mutation is overwritten by GlobeControls on its next interaction.
  const distance = Math.max(80, model.radius * 5);
  await view.controls!.lookAtCoordinate({ coord: ecefCoordinate(model.center), range: distance, tilt: 48, heading: 0 }, false);
}

function renderAll(): void {
  renderLayerCatalog(); renderObjectList(); renderInspector(); renderStats();
  renderPaletteControls();
  element<HTMLButtonElement>('fit-model').disabled = !model;
  element<HTMLButtonElement>('save-view').disabled = !model;
  element<HTMLInputElement>('wireframe').disabled = !model;
  document.querySelectorAll<HTMLButtonElement>('#compass-grid button').forEach(button => { button.disabled = false; });
}

function applyCurrentPalette(): void {
  if (!model) return;
  applyBuildingPalette(model.features, paletteSettings);
  view.notifyChange(model.root);
}

function renderPaletteControls(): void {
  const mode = element<HTMLSelectElement>('colour-mode'); mode.value = paletteSettings.mode; mode.disabled = !model;
  const preset = element<HTMLSelectElement>('palette-preset'); preset.value = paletteSettings.preset; preset.disabled = !model;
  element<HTMLButtonElement>('shuffle-colours').disabled = !model;
  const swatches = element('palette-swatches'); swatches.replaceChildren();
  for (const colour of BUILDING_PALETTES[paletteSettings.preset]) {
    const swatch = document.createElement('span'); swatch.style.backgroundColor = `#${colour.toString(16).padStart(6, '0')}`; swatches.append(swatch);
  }
}

function renderObjectList(): void {
  const target = element('object-list'); target.replaceChildren();
  const query = element<HTMLInputElement>('object-search').value.trim().toLocaleLowerCase();
  const matches = (model?.features ?? []).filter(feature => `${feature.id} ${feature.object.type}`.toLocaleLowerCase().includes(query));
  element('object-count').textContent = String(matches.length);
  if (!model) { target.className = 'object-list empty-state'; target.textContent = 'Load a model to explore its objects.'; return; }
  target.className = 'object-list';
  for (const feature of matches) {
    const row = document.createElement('div'); row.className = `object-row${feature === selected ? ' selected' : ''}`;
    const button = document.createElement('button'); button.className = 'object-focus'; button.setAttribute('aria-label', `Centre ${feature.id} on the map`);
    const text = document.createElement('span'); const id = document.createElement('strong'); id.textContent = feature.id;
    const visibility = feature.mesh || feature.line ? '' : ' · no visible geometry';
    const type = document.createElement('small'); type.textContent = `${feature.object.type}${feature.lods.length ? ` · LoD ${feature.lods.join(', ')}` : ''}${visibility}`;
    text.append(id, type); button.append(text);
    button.addEventListener('click', () => { selectFeature(feature); focusFeature(feature); });
    const info = document.createElement('button'); info.className = 'object-info'; info.textContent = 'i'; info.title = 'Open object information';
    info.setAttribute('aria-label', `Inspect ${feature.id}`);
    info.addEventListener('click', () => { selectFeature(feature); focusFeature(feature); showAnalysisPanel('inspector'); });
    row.append(button, info); target.append(row);
  }
  if (!matches.length) { target.className += ' empty-state'; target.textContent = 'No objects match this search.'; }
}

function selectFeature(feature: FeatureRecord): void {
  setFeatureSelected(selected, false); selected = feature; setFeatureSelected(selected, true);
  renderObjectList(); renderInspector(); view.notifyChange(feature.mesh ?? feature.line);
}

function renderInspector(): void {
  const target = element('inspector'); target.replaceChildren();
  if (!selected) { target.className = 'empty-state'; target.textContent = 'Select an object on the map or in the list.'; return; }
  target.className = 'inspector';
  const heading = document.createElement('div'); heading.className = 'feature-title';
  const title = document.createElement('h3'); title.textContent = selected.id;
  const kind = document.createElement('span'); kind.className = 'badge'; kind.textContent = selected.object.type; heading.append(title, kind); target.append(heading);
  const attributes = selected.object.attributes ?? {};
  const summary = document.createElement('div'); summary.className = 'inspection-metrics';
  const metrics: Array<[string, string]> = [];
  const metricValue = (keys: string[], unit = ''): string | undefined => {
    const key = keys.find(candidate => Object.hasOwn(attributes, candidate)); if (!key) return undefined;
    const value = attributes[key]; if (typeof value === 'number') return `${Number.isInteger(value) ? value : value.toFixed(2)}${unit}`;
    return value === null || typeof value === 'object' ? undefined : String(value);
  };
  const candidates: Array<[string, string | undefined]> = [
    ['Height above ground', metricValue(['height_m', 'measuredHeight'], ' m')],
    ['Ground elevation', metricValue(['ground_z', 'adjacent_ground'], ' m')],
    ['Storeys above ground', metricValue(['storeys_above', 'storeysAboveGround'])],
    ['Storeys below ground', metricValue(['storeys_below', 'storeysBelowGround'])],
    ['Roof elevation', metricValue(['reconstructed_top_z', 'roof_reference_z'], ' m')],
    ['Method', metricValue(['method'])],
    ['Status', metricValue(['status', 'reconstructionStatus'])],
  ];
  for (const candidate of candidates) if (candidate[1] !== undefined) metrics.push(candidate as [string, string]);
  if (!metrics.length) metrics.push(
    ['LoD', selected.lods.join(', ') || 'Not declared'],
    ['Geometry', selected.mesh ? 'Surface' : selected.line ? 'MultiLineString' : 'None'],
  );
  for (const [label, value] of metrics) appendMetric(summary, label, value);
  target.append(summary);
  const method = metricValue(['method']); const description = document.createElement('p'); description.className = 'inspection-description';
  description.textContent = selected.line
    ? 'Source line shown at its supplied XYZ coordinates. No width or terrain clamping is inferred.'
    : method === 'floor_share' ? 'Height inferred from storeys and a reference part; it is not a direct measurement.'
      : method === 'roof_band' ? 'Height uses the selected roof band and sampled ground evidence.'
        : method === 'direct' ? 'Height uses the reported roof and ground evidence.'
          : 'Source attributes and relationships are shown without reinterpretation.';
  target.append(description);
  const relationships = document.createElement('details'); relationships.className = 'inspector-details'; relationships.open = true;
  const relationHeading = document.createElement('summary'); relationHeading.textContent = 'Relationships'; relationships.append(relationHeading);
  appendProperty(relationships, 'Parents', selected.object.parents?.join(', ') || '—');
  appendProperty(relationships, 'Children', selected.object.children?.join(', ') || '—'); target.append(relationships);
  const entries = Object.entries(attributes);
  const all = document.createElement('details'); all.className = 'inspector-details all-attributes';
  const allHeading = document.createElement('summary'); allHeading.textContent = `All attributes and evidence (${entries.length})`; all.append(allHeading);
  if (!entries.length) { const empty = document.createElement('p'); empty.className = 'muted-text'; empty.textContent = 'No attributes.'; all.append(empty); }
  else {
    const table = document.createElement('table'); table.className = 'attribute-table';
    const typeRow = document.createElement('tr'); const typeKey = document.createElement('th'); typeKey.textContent = 'Type'; const typeValue = document.createElement('td'); typeValue.textContent = selected.object.type; typeRow.append(typeKey, typeValue); table.append(typeRow);
    for (const [key, value] of entries) {
      if (value !== null && typeof value === 'object') {
        const headingRow = document.createElement('tr'); headingRow.className = 'structured-attribute-heading'; const headingCell = document.createElement('th'); headingCell.colSpan = 2; headingCell.textContent = key; headingRow.append(headingCell);
        const valueRow = document.createElement('tr'); valueRow.className = 'structured-attribute-value'; const valueCell = document.createElement('td'); valueCell.colSpan = 2;
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(value, null, 2); valueCell.append(pre); valueRow.append(valueCell); table.append(headingRow, valueRow);
      } else {
        const row = document.createElement('tr'); const keyCell = document.createElement('th'); keyCell.textContent = key; const valueCell = document.createElement('td'); valueCell.textContent = formatValue(value); row.append(keyCell, valueCell); table.append(row);
      }
    }
    all.append(table);
  }
  target.append(all);
}

function appendMetric(target: HTMLElement, label: string, value: string): void {
  const card = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = value;
  const span = document.createElement('span'); span.textContent = label; card.append(strong, span); target.append(card);
}

function renderStats(): void {
  const target = element('stats'); target.replaceChildren();
  if (!model) { target.className = 'empty-state'; target.textContent = 'Metrics appear after loading a CityJSON file.'; return; }
  target.className = 'stats-grid';
  const types = new Map<string, number>(); for (const feature of model.features) types.set(feature.object.type, (types.get(feature.object.type) ?? 0) + 1);
  const headlineStats: Array<[string, string]> = [
    ['Declared objects', model.features.length.toLocaleString('en-US')],
    ['Visible objects', model.drawableFeatureCount.toLocaleString('en-US')],
    ['Triangles', model.triangleCount.toLocaleString('en-US')],
    ['Line segments', model.lineSegmentCount.toLocaleString('en-US')],
    ['Source CRS', model.sourceCrs],
  ];
  for (const [label, value] of headlineStats) {
    const card = document.createElement('div'); card.className = 'stat-card'; const strong = document.createElement('strong'); strong.textContent = value;
    const span = document.createElement('span'); span.textContent = label; card.append(strong, span); target.append(card);
  }
  const chart = document.createElement('div'); chart.className = 'type-chart';
  const max = Math.max(...types.values());
  for (const [type, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    const row = document.createElement('div'); row.className = 'chart-row';
    const label = document.createElement('span'); label.textContent = type;
    const bar = document.createElement('i'); bar.style.setProperty('--bar', `${count / max * 100}%`);
    const value = document.createElement('b'); value.textContent = String(count); row.append(label, bar, value); chart.append(row);
  }
  target.append(chart);
}

async function submitExternalLayer(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form); const name = String(data.get('name') ?? '');
  const attributionName = String(data.get('attributionName') ?? '').trim();
  const attributionUrl = String(data.get('attributionUrl') ?? '').trim();
  const authorizationMode = String(data.get('authorizationMode') ?? '');
  const authorizationToken = String(data.get('authorizationToken') ?? '');
  await addMapSource({
    id: `external-${Date.now()}-${++sourceInstance}`,
    name,
    kind: String(data.get('kind')) as 'xyz' | 'wms' | 'wmts',
    url: String(data.get('url') ?? ''),
    serviceLayer: String(data.get('serviceLayer') ?? ''),
    tileMatrixSet: String(data.get('tileMatrixSet') ?? ''),
    style: String(data.get('style') ?? ''),
    crs: String(data.get('crs')) as 'EPSG:3857' | 'EPSG:4326',
    format: String(data.get('format')) as 'image/png' | 'image/jpeg',
    attribution: attributionName ? { name: attributionName, url: attributionUrl || undefined } : undefined,
    authorization: authorizationMode ? {
      mode: authorizationMode as typeof ExternalLayerAuthorizationMode[keyof typeof ExternalLayerAuthorizationMode],
      token: authorizationToken,
      parameter: String(data.get('authorizationParameter') ?? ''),
    } : undefined,
  });
}

async function addDefaultBaseMap(): Promise<void> {
  const preset = layerPresets.find(candidate => candidate.key === 'nasa-blue-marble');
  if (!preset) return;
  await addMapSource(instantiatePreset(preset, ++sourceInstance), false, false);
}

async function addMapSource(input: Parameters<typeof addExternalLayer>[1], closeDialog = true, notify = true): Promise<void> {
  try {
    if (notify) setStatus(`Adding ${input.name}…`, 'working');
    const record = await addExternalLayer(view, input);
    externalLayers.unshift(record);
    layerDisplayOrder.unshift(record.layer.id);
    layerVisibility.set(record.layer.id, true);
    syncRasterOrder();
    renderLayerCatalog();
    if (closeDialog) closeDataModal();
    if (notify) setStatus(`${input.name} added.`, 'success');
  } catch (error) {
    if (notify) setStatus(error instanceof Error ? error.message : 'The layer could not be added.', 'error');
  }
}

function createLayerGroup(): void {
  const group: LayerGroup = { id: `group-${++groupCounter}`, name: `Group ${groupCounter}`, visible: true, layerIds: [] };
  layerGroups.push(group);
  renderLayerCatalog();
}

function renderLayerCatalog(): void {
  const target = element('scene-layer-list');
  target.replaceChildren();
  const availableIds = layerDisplayOrder.filter(id => getLayerInfo(id));
  element('layer-count').textContent = String(availableIds.length);
  if (!availableIds.length && !layerGroups.length) {
    target.className = 'scene-layer-list empty-state';
    target.textContent = 'Add a CityJSON model or map source to build the scene.';
    renderMapAttribution();
    return;
  }
  target.className = 'scene-layer-list';
  const groupedIds = new Set(layerGroups.flatMap(group => group.layerIds));
  const ungrouped = availableIds.filter(id => !groupedIds.has(id));
  if (ungrouped.length) target.append(renderCatalogSection(undefined, ungrouped));
  for (const group of layerGroups) {
    const ids = availableIds.filter(id => group.layerIds.includes(id));
    target.append(renderCatalogSection(group, ids));
  }
  renderMapAttribution();
}

function renderCatalogSection(group: LayerGroup | undefined, ids: string[]): HTMLElement {
  const section = document.createElement('section'); section.className = 'catalog-section';
  const header = document.createElement('header'); header.className = 'group-header';
  if (group) {
    const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = group.visible;
    visible.setAttribute('aria-label', `Show ${group.name}`);
    visible.addEventListener('change', () => { group.visible = visible.checked; for (const id of group.layerIds) applyLayerVisibility(id); renderLayerCatalog(); });
    const name = document.createElement('input'); name.className = 'group-name'; name.value = group.name; name.setAttribute('aria-label', 'Group name');
    name.addEventListener('change', () => { const next = name.value.trim(); if (next) group.name = next; else name.value = group.name; });
    const remove = document.createElement('button'); remove.className = 'text-button subtle'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${group.name}`);
    remove.addEventListener('click', () => { layerGroups.splice(layerGroups.indexOf(group), 1); renderLayerCatalog(); });
    header.append(visible, name, remove);
  } else {
    const label = document.createElement('strong'); label.textContent = 'Ungrouped';
    const count = document.createElement('span'); count.className = 'group-count'; count.textContent = String(ids.length);
    header.append(label, count);
  }
  section.append(header);
  const list = document.createElement('div'); list.className = 'catalog-layer-list';
  for (const id of ids) list.append(renderCatalogLayer(id));
  if (!ids.length) { const empty = document.createElement('div'); empty.className = 'group-empty'; empty.textContent = 'No layers in this group.'; list.append(empty); }
  section.append(list);
  return section;
}

function renderCatalogLayer(id: string): HTMLElement {
  const info = getLayerInfo(id)!;
  const card = document.createElement('article'); card.className = 'catalog-layer'; card.dataset.layerId = id; card.draggable = true;
  card.addEventListener('dragstart', event => {
    event.dataTransfer?.setData('application/x-3dlodmv-layer', id);
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    clearLayerDropIndicators();
  });
  card.addEventListener('dragover', event => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const transferTypes = Array.from(transfer.types);
    if (!transferTypes.some(type => type === 'application/x-3dlodmv-layer' || type === 'text/plain')) return;
    event.preventDefault(); transfer.dropEffect = 'move';
    const placement = layerDropPlacement(card, event.clientY);
    clearLayerDropIndicators(); card.classList.add(placement === 'before' ? 'drop-before' : 'drop-after');
  });
  card.addEventListener('dragleave', event => { if (!card.contains(event.relatedTarget as Node | null)) card.classList.remove('drop-before', 'drop-after'); });
  card.addEventListener('drop', event => {
    const draggedId = event.dataTransfer?.getData('application/x-3dlodmv-layer') || event.dataTransfer?.getData('text/plain');
    if (!draggedId || draggedId === id) return;
    event.preventDefault(); event.stopPropagation();
    const placement = layerDropPlacement(card, event.clientY);
    const targetGroupId = layerGroups.find(candidate => candidate.layerIds.includes(id))?.id;
    assignLayerToGroup(layerGroups, draggedId, targetGroupId);
    layerDisplayOrder = repositionLayer(layerDisplayOrder, draggedId, id, placement);
    syncRasterOrder(); renderLayerCatalog();
    setStatus(`${getLayerInfo(draggedId)?.name ?? 'Layer'} moved ${placement} ${info.name}.`, 'success');
  });
  const top = document.createElement('div'); top.className = 'catalog-layer-main';
  const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = layerVisibility.get(id) ?? true;
  visible.setAttribute('aria-label', `Show ${info.name}`);
  visible.addEventListener('change', () => { layerVisibility.set(id, visible.checked); applyLayerVisibility(id); });
  const handle = document.createElement('span'); handle.className = 'drag-handle'; handle.textContent = '⠿'; handle.title = 'Drag to reorder'; handle.setAttribute('aria-label', `Drag ${info.name} to reorder`);
  const dot = document.createElement('span'); dot.className = `layer-dot ${info.kind === 'CITYJSON' ? 'city' : 'external'}`;
  const copy = document.createElement('span'); copy.className = 'catalog-copy';
  const name = document.createElement('strong'); name.textContent = info.name;
  const meta = document.createElement('small'); meta.textContent = info.meta;
  copy.append(name, meta); top.append(handle, visible, dot, copy);
  const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${info.name}`);
  remove.addEventListener('click', () => removeLayer(id)); top.append(remove); card.append(top);

  const controls = document.createElement('div'); controls.className = 'catalog-controls';
  const group = document.createElement('select'); group.setAttribute('aria-label', `Group for ${info.name}`);
  group.append(new Option('Ungrouped', ''));
  for (const candidate of layerGroups) group.append(new Option(candidate.name, candidate.id));
  group.value = layerGroups.find(candidate => candidate.layerIds.includes(id))?.id ?? '';
  group.addEventListener('change', () => { assignLayerToGroup(layerGroups, id, group.value || undefined); applyLayerVisibility(id); renderLayerCatalog(); });
  const raise = layerMoveButton('Up', id, 'raise', info.name);
  const lower = layerMoveButton('Down', id, 'lower', info.name);
  controls.append(group, raise, lower); card.append(controls);
  if (info.record) {
    const opacityRow = document.createElement('label'); opacityRow.className = 'opacity-row'; opacityRow.textContent = 'Opacity';
    const opacity = document.createElement('input'); opacity.type = 'range'; opacity.min = '0'; opacity.max = '1'; opacity.step = '.05'; opacity.value = String(info.record.layer.opacity);
    opacity.setAttribute('aria-label', `Opacity for ${info.name}`);
    opacity.addEventListener('input', () => { info.record!.layer.opacity = Number(opacity.value); view.notifyChange(view.tileLayer); });
    opacityRow.append(opacity); card.append(opacityRow);
  }
  return card;
}

function layerMoveButton(label: string, id: string, direction: LayerMove, name: string): HTMLButtonElement {
  const button = document.createElement('button'); button.className = 'mini-button'; button.textContent = label; button.setAttribute('aria-label', `${label} ${name}`);
  const index = layerDisplayOrder.indexOf(id);
  button.disabled = direction === 'raise' ? index <= 0 : index < 0 || index >= layerDisplayOrder.length - 1;
  button.addEventListener('click', () => { layerDisplayOrder = moveLayer(layerDisplayOrder, id, direction); syncRasterOrder(); renderLayerCatalog(); });
  return button;
}

function getLayerInfo(id: string): { name: string; kind: string; meta: string; record?: ExternalLayerRecord } | undefined {
  if (model?.layer.id === id) return {
    name: 'Local CityJSON', kind: 'CITYJSON',
    meta: `${model.features.length.toLocaleString('en-US')} objects · ${model.sourceCrs}`,
  };
  const record = externalLayers.find(candidate => candidate.layer.id === id);
  if (!record) return undefined;
  return { name: record.input.name, kind: record.input.kind.toUpperCase(), meta: `${record.input.kind.toUpperCase()} · ${record.input.crs ?? 'EPSG:3857'}`, record };
}

function removeLayer(id: string): void {
  if (model?.layer.id === id) {
    view.removeLayer(id, true); model = undefined; selected = undefined;
  } else {
    const index = externalLayers.findIndex(record => record.layer.id === id);
    if (index >= 0) { view.removeLayer(id, true); externalLayers.splice(index, 1); }
  }
  layerDisplayOrder = layerDisplayOrder.filter(candidate => candidate !== id);
  layerVisibility.delete(id);
  assignLayerToGroup(layerGroups, id, undefined);
  renderAll(); syncRasterOrder(); view.notifyChange(view.tileLayer);
}

function applyLayerVisibility(id: string): void {
  const ownVisibility = layerVisibility.get(id) ?? true;
  const group = layerGroups.find(candidate => candidate.layerIds.includes(id));
  const visible = ownVisibility && (group?.visible ?? true);
  if (model?.layer.id === id) model.layer.visible = visible;
  const record = externalLayers.find(candidate => candidate.layer.id === id);
  if (record) record.layer.visible = visible;
  view.notifyChange(record ? view.tileLayer : model?.root);
  renderMapAttribution();
}

function syncRasterOrder(): void {
  const bottomToTop = layerDisplayOrder.filter(id => externalLayers.some(record => record.layer.id === id)).reverse();
  bottomToTop.forEach((id, index) => ColorLayersOrdering.moveLayerToIndex(view, id, index));
}

function layerDropPlacement(card: HTMLElement, pointerY: number): LayerDropPlacement {
  const bounds = card.getBoundingClientRect();
  return pointerY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

function clearLayerDropIndicators(): void {
  document.querySelectorAll('.catalog-layer.drop-before, .catalog-layer.drop-after')
    .forEach(node => node.classList.remove('drop-before', 'drop-after'));
}

function renderMapAttribution(): void {
  const target = element('map-attribution'); target.replaceChildren();
  const credits: Array<{ name: string; url?: string }> = externalLayers.filter(record => {
    const group = layerGroups.find(candidate => candidate.layerIds.includes(record.layer.id));
    return (layerVisibility.get(record.layer.id) ?? true) && (group?.visible ?? true) && record.input.attribution?.name;
  }).map(record => record.input.attribution!);
  if (terrain && terrainLayerVisible(terrain) && terrain.attribution) credits.push(terrain.attribution);
  for (const [index, credit] of credits.entries()) {
    if (index) target.append(' · ');
    if (credit.url) {
      const link = document.createElement('a'); link.href = credit.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = credit.name; target.append(link);
    } else target.append(credit.name);
  }
  target.hidden = !credits.length;
}

function renderTerrainCatalog(): void {
  const target = element('terrain-layer-list'); target.replaceChildren();
  element('terrain-count').textContent = terrain ? '1' : '0';
  if (!terrain) { target.className = 'group-empty'; target.textContent = 'No terrain loaded.'; return; }
  target.className = 'terrain-layer-list';
  const card = document.createElement('article'); card.className = 'catalog-layer terrain-layer';
  const main = document.createElement('div'); main.className = 'catalog-layer-main';
  const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = terrainLayerVisible(terrain);
  visible.setAttribute('aria-label', `Show ${terrain.name}`);
  visible.addEventListener('change', () => { if (!terrain) return; setTerrainLayerVisible(terrain, visible.checked); renderMapAttribution(); view.notifyChange(view.tileLayer); });
  const dot = document.createElement('span'); dot.className = 'layer-dot terrain';
  const copy = document.createElement('span'); copy.className = 'catalog-copy';
  const name = document.createElement('strong'); name.textContent = terrain.name;
  const meta = document.createElement('small');
  const range = terrain.elevationRange ? ` · ${terrain.elevationRange[0].toFixed(1)}–${terrain.elevationRange[1].toFixed(1)} m` : '';
  meta.textContent = `${terrain.kind === 'local' ? terrain.sourceCrs : terrain.coverage ?? 'Remote elevation'}${range}`;
  copy.append(name, meta);
  const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${terrain.name}`);
  remove.addEventListener('click', () => { if (!terrain) return; view.removeLayer(terrain.layer.id, true); terrain = undefined; renderTerrainCatalog(); renderMapAttribution(); view.notifyChange(view.tileLayer); });
  main.append(visible, dot, copy, remove); card.append(main);
  if (terrain.center && terrain.radius) {
    const fit = document.createElement('button'); fit.className = 'mini-button terrain-fit'; fit.textContent = 'Fit terrain'; fit.addEventListener('click', fitTerrain); card.append(fit);
  }
  target.append(card);
}

function terrainLayerVisible(record: TerrainRecord): boolean {
  return record.layer.scale !== 0;
}

function setTerrainLayerVisible(record: TerrainRecord, visible: boolean): void {
  record.layer.scale = visible ? 1 : 0;
}

function handlePointerMove(event: PointerEvent): void {
  if (measurementActive) { tooltip.hidden = true; viewerElement.style.cursor = 'crosshair'; return; }
  const feature = pickFeature(event);
  tooltip.hidden = !feature; viewerElement.style.cursor = feature ? 'pointer' : '';
  if (feature) { tooltip.textContent = feature.id; tooltip.style.left = `${event.clientX + 14}px`; tooltip.style.top = `${event.clientY + 12}px`; }
}

function pickScenePosition(event: MouseEvent | PointerEvent): THREE.Vector3 | undefined {
  const rect = viewerElement.getBoundingClientRect();
  const position = view.getPickingPositionFromDepth(new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top));
  return position?.lengthSq() ? position.clone() : undefined;
}

function pickFeature(event: MouseEvent | PointerEvent): FeatureRecord | undefined {
  if (!model) return undefined; const rect = viewerElement.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
  raycaster.setFromCamera(pointer, view.camera3D);
  const objects = model.features.flatMap(feature => [feature.mesh, feature.line].filter(Boolean)) as THREE.Object3D[];
  const hit = raycaster.intersectObjects(objects, false)[0];
  return hit ? model.features.find(feature => feature.id === hit.object.userData.featureId) : undefined;
}

function featureWorldCentre(feature: FeatureRecord): THREE.Vector3 | undefined {
  const object = feature.mesh ?? feature.line; if (!object) return undefined;
  object.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(object);
  return box.isEmpty() ? undefined : box.getCenter(new THREE.Vector3());
}

function focusFeature(feature: FeatureRecord): void {
  const object = feature.mesh ?? feature.line; const center = featureWorldCentre(feature); if (!object || !center) return;
  const box = new THREE.Box3().setFromObject(object); const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(4, size.length() * 0.65); const controls = view.controls!;
  void controls.lookAtCoordinate({
    coord: ecefCoordinate(center), range: Math.max(25, radius * 3.2),
    tilt: Math.max(25, Math.min(70, controls.getTilt())), heading: controls.getHeading(),
  }, false);
}

function handleContextMenu(event: MouseEvent): void {
  const feature = pickFeature(event); if (feature) selectFeature(feature);
  const center = feature ? featureWorldCentre(feature) : pickScenePosition(event) ?? (selected ? featureWorldCentre(selected) : undefined); if (!center) return;
  event.preventDefault(); const geographic = new Coordinates('EPSG:4978', center.x, center.y, center.z).as('EPSG:4326');
  const longitude = geographic.x; const latitude = geographic.y; const altitude = geographic.z;
  const text = `${latitude.toFixed(7)}, ${longitude.toFixed(7)}, ${altitude.toFixed(2)}`;
  const button = element<HTMLButtonElement>('copy-object-coordinates'); button.textContent = text;
  button.onclick = async () => {
    try { await navigator.clipboard.writeText(text); setStatus(`Coordinates copied${feature ? ` for ${feature.id}` : ''} (EPSG:4326).`, 'success'); }
    catch { setStatus('The browser did not allow clipboard access.', 'error'); }
    hideCoordinateMenu();
  };
  const measure = element<HTMLButtonElement>('measure-from-coordinate');
  measure.onclick = () => { clearMeasurement(); addMeasurementPoint(center); showAnalysisPanel('measure'); setMeasurementActive(true); hideCoordinateMenu(); };
  const menu = element<HTMLElement>('coordinate-menu'); menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 330)}px`; menu.style.top = `${Math.min(event.clientY, window.innerHeight - 86)}px`;
}

function hideCoordinateMenu(): void { element<HTMLElement>('coordinate-menu').hidden = true; }

function setMeasurementActive(active: boolean): void {
  measurementActive = active;
  const button = element<HTMLButtonElement>('toggle-measurement');
  button.textContent = active ? 'Stop measuring' : 'Start measuring'; button.classList.toggle('primary', !active);
  viewerElement.classList.toggle('measuring', active);
  if (!active) viewerElement.style.cursor = '';
}

function clearMeasurement(): void {
  measurementPoints.length = 0; renderMeasurement();
}

function addMeasurementPoint(point: THREE.Vector3 | undefined): void {
  if (!point) { setStatus('No map or model surface was found at that position.', 'error'); return; }
  measurementPoints.push(point.clone()); renderMeasurement();
}

function renderMeasurement(): void {
  for (const child of [...measurementRoot.children]) {
    const renderable = child as THREE.Line | THREE.Points;
    renderable.geometry?.dispose();
    const material = renderable.material; if (Array.isArray(material)) material.forEach(item => item.dispose()); else material?.dispose();
    measurementRoot.remove(child);
  }
  if (measurementPoints.length) {
    const origin = measurementPoints[0]!; measurementRoot.position.copy(origin);
    const positions = new Float32Array(measurementPoints.length * 3);
    measurementPoints.forEach((point, index) => { const relative = point.clone().sub(origin); positions.set([relative.x, relative.y, relative.z], index * 3); });
    const pointGeometry = new THREE.BufferGeometry(); pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0xffd166, size: 8, sizeAttenuation: false, depthTest: false })); points.renderOrder = 1000; measurementRoot.add(points);
    if (measurementPoints.length > 1) {
      const lineGeometry = new THREE.BufferGeometry(); lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
      const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false })); line.renderOrder = 999; measurementRoot.add(line);
    }
    measurementRoot.updateMatrixWorld(true);
  }
  let horizontal = 0; let spatial = 0;
  for (let index = 1; index < measurementPoints.length; index += 1) {
    horizontal += approximateGeodesicDistance(measurementPoints[index - 1]!, measurementPoints[index]!);
    spatial += measurementPoints[index - 1]!.distanceTo(measurementPoints[index]!);
  }
  const readout = element('measurement-readout'); const values = readout.querySelectorAll('strong');
  values[0]!.textContent = String(measurementPoints.length); values[1]!.textContent = formatDistance(horizontal); values[2]!.textContent = formatDistance(spatial);
  view.notifyChange(measurementRoot);
}

function approximateGeodesicDistance(first: THREE.Vector3, second: THREE.Vector3): number {
  const a = ecefCoordinate(first).as('EPSG:4326'); const b = ecefCoordinate(second).as('EPSG:4326');
  const latitudeA = THREE.MathUtils.degToRad(a.y); const latitudeB = THREE.MathUtils.degToRad(b.y);
  const deltaLatitude = latitudeB - latitudeA; const deltaLongitude = THREE.MathUtils.degToRad(b.x - a.x);
  const haversine = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function formatDistance(metres: number): string { return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(metres < 10 ? 2 : 1)} m`; }

function setCardinalView(bearing: number): void {
  const controls = view.controls!; const coord = model ? ecefCoordinate(model.center) : controls.getLookAtCoordinate();
  const range = model ? Math.max(80, model.radius * 4.2) : controls.getRange();
  void controls.lookAtCoordinate({ coord, range, heading: bearing, tilt: 62 }, false);
}

function setTopView(): void {
  const controls = view.controls!; const coord = model ? ecefCoordinate(model.center) : controls.getLookAtCoordinate();
  const range = model ? Math.max(80, model.radius * 4.2) : controls.getRange();
  void controls.lookAtCoordinate({ coord, range, heading: controls.getHeading(), tilt: 0 }, false);
}

function fitTerrain(): void {
  if (!terrain?.center || !terrain.radius) return; const distance = Math.max(100, terrain.radius * 3.5);
  void view.controls!.lookAtCoordinate({ coord: ecefCoordinate(terrain.center), range: distance, tilt: 48, heading: 0 }, false);
}

function ecefCoordinate(point: THREE.Vector3): Coordinates { return new Coordinates('EPSG:4978', point.x, point.y, point.z); }

function setupAnalysisResizer(): void {
  const panel = element<HTMLElement>('analysis'); const handle = element<HTMLElement>('analysis-resizer');
  const resize = (clientX: number) => {
    const maximum = Math.max(500, window.innerWidth - 468); const width = Math.min(maximum, Math.max(500, window.innerWidth - clientX - 72));
    panel.style.setProperty('--analysis-width', `${width}px`);
  };
  handle.addEventListener('pointerdown', event => {
    handle.setPointerCapture(event.pointerId); const move = (next: PointerEvent) => resize(next.clientX);
    const finish = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish);
  });
  handle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault();
    const current = panel.getBoundingClientRect().width; const maximum = Math.max(500, window.innerWidth - 468);
    panel.style.setProperty('--analysis-width', `${Math.min(maximum, Math.max(500, current + (event.key === 'ArrowLeft' ? 24 : -24)))}px`);
  });
}

function saveCurrentView(): void {
  savedViews.push({ name: `View ${savedViews.length + 1}`, position: view.camera3D.position.clone(), quaternion: view.camera3D.quaternion.clone() });
  const target = element('saved-views'); target.className = 'saved-views'; target.replaceChildren();
  for (const saved of savedViews) {
    const button = document.createElement('button'); button.className = 'saved-view'; button.textContent = saved.name;
    button.addEventListener('click', () => { view.camera3D.position.copy(saved.position); view.camera3D.quaternion.copy(saved.quaternion); view.notifyChange(view.camera3D); }); target.append(button);
  }
}

function activatePanel(name: string): void {
  document.querySelectorAll('.tab').forEach(node => node.classList.toggle('active', (node as HTMLElement).dataset.panel === name));
  document.querySelectorAll('.panel').forEach(node => node.classList.toggle('active', (node as HTMLElement).dataset.panelContent === name));
}

function toggleAnalysisPanel(name: string): void {
  const panel = element<HTMLElement>('analysis');
  const selectedTab = document.querySelector<HTMLButtonElement>(`.tab[data-panel="${name}"]`)!;
  if (!panel.classList.contains('closed') && selectedTab.classList.contains('active')) { closeAnalysisPanel(); return; }
  showAnalysisPanel(name);
}

function showAnalysisPanel(name: string): void {
  if (name !== 'measure' && measurementActive) setMeasurementActive(false);
  const panel = element<HTMLElement>('analysis'); const selectedTab = document.querySelector<HTMLButtonElement>(`.tab[data-panel="${name}"]`)!;
  activatePanel(name); panel.classList.remove('closed');
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => tab.setAttribute('aria-expanded', String(tab === selectedTab)));
}

function closeAnalysisPanel(): void {
  if (measurementActive) setMeasurementActive(false);
  element('analysis').classList.add('closed');
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => tab.setAttribute('aria-expanded', 'false'));
}

function toggleLayersPanel(): void {
  const panel = element('layer-panel');
  if (panel.classList.contains('closed')) openLayersPanel(); else closeLayersPanel();
}

function openLayersPanel(): void {
  element('layer-panel').classList.remove('closed');
  const button = element<HTMLButtonElement>('toggle-layers'); button.classList.add('active'); button.setAttribute('aria-expanded', 'true');
}

function closeLayersPanel(): void {
  element('layer-panel').classList.add('closed');
  const button = element<HTMLButtonElement>('toggle-layers'); button.classList.remove('active'); button.setAttribute('aria-expanded', 'false');
}

function appendProperty(target: HTMLElement, key: string, value: string): void {
  const row = document.createElement('div'); row.className = 'property-row'; const term = document.createElement('span'); term.textContent = key;
  const detail = document.createElement('strong'); detail.textContent = value; row.append(term, detail); target.append(row);
}

function formatValue(value: unknown): string {
  if (value === null) return 'null'; if (typeof value === 'object') return JSON.stringify(value); return String(value);
}

function setStatus(message: string, state: 'working' | 'success' | 'error'): void {
  if (state === 'working') return;
  Toastify({
    text: message,
    duration: state === 'error' ? 5200 : 3200,
    gravity: 'bottom',
    position: 'center',
    stopOnFocus: true,
    className: `app-toast app-toast-${state}`,
    escapeMarkup: true,
  }).showToast();
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id); if (!found) throw new Error(`Elemento #${id} no encontrado.`); return found as T;
}
