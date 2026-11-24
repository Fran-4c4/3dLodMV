import { expect, test } from '@playwright/test';
import { writeArrayBuffer } from 'geotiff';

test('uses a stable add-data dialog and exposes the analysis panels', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('https://gibs.earthdata.nasa.gov/**', route => route.fulfill({
    status: 200, contentType: 'image/jpeg',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.route('https://xyz-mdt.idee.es/**', route => route.fulfill({
    status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg7OoAAAGjARTOqORWAAAAAElFTkSuQmCC', 'base64'),
  }));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Add data to map' })).toBeHidden();
  await expect(page.locator('#analysis')).toHaveClass(/closed/);
  await expect(page.locator('#scene-layer-list')).toContainText('NASA Blue Marble');
  await expect(page.getByRole('link', { name: /NASA GIBS/ })).toBeVisible();
  await page.getByLabel('Show NASA Blue Marble').uncheck();
  await page.locator('#open-data-left').click();
  await expect(page.getByRole('dialog', { name: 'Add data to map' })).toBeVisible();
  await expect(page.getByRole('button', { name: /CityJSON file/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Local terrain \/ DTM/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /IGN Spain Terrain/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mapzen Global Terrain/ })).toBeVisible();
  await expect(page.locator('#terrain-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: /OpenStreetMap Standard/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /IGN Base Map/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /PNOA Latest Orthophoto/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close add data dialog' }).click();
  await expect(page.locator('header.topbar')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /3dLodMV/ })).toHaveCount(0);
  await expect(page.locator('.floating-brand')).toBeVisible();
  expect(await page.locator('.workspace').evaluate(node => node.getBoundingClientRect().height)).toBe(900);
  const cameraWithoutModel = await page.evaluate(() => (window as any).__3dLodMVDebug.view.camera3D.position.toArray());
  await page.getByRole('button', { name: /Views/ }).click();
  await page.getByRole('button', { name: 'E', exact: true }).click();
  const cameraWithoutModelAfterView = await page.evaluate(() => (window as any).__3dLodMVDebug.view.camera3D.position.toArray());
  expect(cameraWithoutModelAfterView).not.toEqual(cameraWithoutModel);
  await page.getByRole('button', { name: 'Close analysis panel' }).click();
  await expect(page.locator('#analysis')).toHaveClass(/closed/);
  await page.getByRole('button', { name: 'Close layers' }).click();
  await expect(page.locator('#layer-panel')).toHaveClass(/closed/);
  await page.getByRole('button', { name: /Layers/ }).click();
  await expect(page.locator('#layer-panel')).not.toHaveClass(/closed/);
  await page.locator('#open-data-left').click();

  const initialUrl = page.url();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['{}'], 'dropped.city.json', { type: 'application/json' }));
    document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  expect(page.url()).toBe(initialUrl);
  await expect(page.locator('#status')).toHaveCount(0);

  await page.route('**/examples/demo.city.json', async route => {
    await new Promise(resolve => setTimeout(resolve, 120));
    await route.continue();
  });
  await page.getByRole('button', { name: /Example dataset/ }).click();
  await expect(page.locator('#loading-overlay')).toBeVisible();
  await expect(page.locator('#loading-stage')).toContainText('Reading');
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.locator('.toastify')).toContainText('2 objects');
  await expect(page.getByRole('dialog', { name: 'Add data to map' })).toBeHidden();
  await expect(page.locator('#analysis')).toHaveClass(/closed/);
  await page.getByRole('button', { name: /Objects/ }).click();
  await expect(page.locator('.search-box svg')).toBeVisible();
  await expect(page.getByText('building-a', { exact: true })).toBeVisible();
  const cameraBeforeFocus = await page.evaluate(() => (window as any).__3dLodMVDebug.view.camera3D.position.toArray());
  await page.getByRole('button', { name: 'Centre building-a on the map' }).click();
  await expect(page.locator('.tab[data-panel="objects"]')).toHaveClass(/active/);
  const cameraAfterFocus = await page.evaluate(() => (window as any).__3dLodMVDebug.view.camera3D.position.toArray());
  expect(cameraAfterFocus).not.toEqual(cameraBeforeFocus);
  await page.getByRole('button', { name: 'Inspect building-a' }).click();
  await expect(page.locator('.tab[data-panel="inspector"]')).toHaveClass(/active/);
  await expect(page.getByText('14 m', { exact: true })).toBeVisible();
  await expect(page.getByText('All attributes and evidence (5)', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic QA example', { exact: false })).toBeHidden();
  const inspectorColours = await page.evaluate(() => ({
    title: getComputedStyle(document.querySelector('#inspector .feature-title h3')!).color,
    summary: getComputedStyle(document.querySelector('#inspector summary')!).color,
  }));
  expect(inspectorColours.title).not.toBe('rgb(106, 116, 133)');
  expect(inspectorColours.summary).not.toBe('rgb(106, 116, 133)');
  const objectScreenPoint = await page.evaluate(() => {
    const debug = (window as any).__3dLodMVDebug; const mesh = debug.model.features[0].mesh;
    mesh.geometry.computeBoundingSphere(); mesh.updateMatrixWorld(true);
    const projected = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld).project(debug.view.camera3D);
    const bounds = document.querySelector('#viewer')!.getBoundingClientRect();
    return { x: bounds.left + (projected.x + 1) * bounds.width / 2, y: bounds.top + (1 - projected.y) * bounds.height / 2 };
  });
  await page.evaluate(({ x, y }) => document.querySelector('#viewer')!.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
  })), objectScreenPoint);
  await expect(page.locator('#coordinate-menu')).toBeVisible();
  await expect(page.locator('#copy-object-coordinates')).toHaveText(/^-?\d+\.\d{7}, -?\d+\.\d{7}, -?\d+\.\d{2}$/);
  await expect(page.getByRole('menuitem', { name: 'Measure from here' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Measure from here' }).click();
  await expect(page.locator('#measurement-readout')).toContainText('1');
  const viewerBounds = await page.locator('#viewer').boundingBox();
  await page.mouse.click(viewerBounds!.x + viewerBounds!.width / 2, viewerBounds!.y + viewerBounds!.height / 2);
  await expect(page.locator('#measurement-readout')).toContainText('2');

  await page.locator('#open-data-left').click();
  await page.getByRole('button', { name: /IGN Spain Terrain/ }).click();
  await expect(page.locator('#terrain-count')).toHaveText('1');
  await expect(page.locator('#terrain-layer-list')).toContainText('IGN Spain Terrain');
  await expect(page.getByRole('link', { name: /IGN\/CNIG/ })).toBeVisible();

  const terrainBuffer = writeArrayBuffer(new Float32Array([
    640, 641, 642, 643, 639, 640, 641, 642,
    638, 639, 640, 641, 637, 638, 639, 640,
  ]), {
    width: 4, height: 4, BitsPerSample: [32], SampleFormat: [3], SamplesPerPixel: 1,
    ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, 439990, 4470030, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 25830,
  });
  await page.locator('#terrain-file').setInputFiles({ name: 'synthetic-terrain.tif', mimeType: 'image/tiff', buffer: Buffer.from(terrainBuffer) });
  await expect(page.getByRole('checkbox', { name: 'Show synthetic-terrain.tif' })).toBeChecked({ timeout: 45000 });
  await expect(page.locator('#terrain-layer-list')).toContainText('EPSG:25830');
  await expect(page.locator('.toastify').filter({ hasText: 'terrain added' }).last()).toBeVisible();

  const panelSizing = await page.evaluate(() => ({
    analysis: document.querySelector('#analysis')!.getBoundingClientRect().width,
    analysisFont: getComputedStyle(document.querySelector('#analysis .panel')!).fontSize,
    layersFont: getComputedStyle(document.querySelector('#layer-panel')!).fontSize,
  }));
  expect(panelSizing.analysis).toBeGreaterThanOrEqual(500);
  expect(Number.parseFloat(panelSizing.analysisFont)).toBeGreaterThanOrEqual(Number.parseFloat(panelSizing.layersFont));

  await page.getByRole('button', { name: /Views/ }).click();
  const cameraBeforeNorth = await page.evaluate(() => (window as any).__3dLodMVDebug.view.camera3D.position.toArray());
  await page.getByRole('button', { name: 'N', exact: true }).click();
  const cameraAfterNorth = await page.evaluate(() => (window as any).__3dLodMVDebug.view.camera3D.position.toArray());
  expect(cameraAfterNorth).not.toEqual(cameraBeforeNorth);

  const contrastColours = await page.evaluate(() => (window as any).__3dLodMVDebug.model.features.map((feature: any) => feature.mesh?.material.color.getHex()));
  expect(new Set(contrastColours).size).toBeGreaterThan(1);
  await page.getByRole('button', { name: /Style/ }).click();
  await expect(page.getByText('Building colours', { exact: true })).toBeVisible();
  await page.getByLabel('Colour mode').selectOption('type');
  const typeColours = await page.evaluate(() => (window as any).__3dLodMVDebug.model.features.map((feature: any) => feature.mesh?.material.color.getHex()));
  expect(new Set(typeColours).size).toBe(1);
  await page.getByRole('button', { name: 'Shuffle building colours' }).click();
  await expect(page.getByLabel('Colour mode')).toHaveValue('building');

  await page.locator('#open-data-left').click();
  await page.getByRole('button', { name: /WMTS service/ }).click();
  await expect(page.getByRole('dialog', { name: 'Configure map source' })).toBeVisible();
  await expect(page.getByLabel('Tile matrix set')).toBeVisible();
  await page.getByRole('button', { name: 'Back to sources' }).click();
  await page.getByRole('button', { name: /Raster tiles/ }).click();
  await page.getByLabel('Authorization').selectOption('bearer');
  await expect(page.getByLabel('Token', { exact: true })).toBeVisible();
  await page.getByLabel('Token', { exact: true }).fill('not-persisted-in-the-catalogue');
  await page.getByLabel('Name', { exact: true }).fill('Local test layer');
  await page.getByLabel('Service URL').fill('http://127.0.0.1:8014/missing/{z}/{x}/{y}.png');
  await page.getByLabel('Attribution name').fill('Example provider');
  await page.getByLabel('Attribution URL').fill('https://example.com/data');
  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.getByText('Local test layer', { exact: true })).toBeVisible();
  await expect(page.locator('#scene-layer-list')).not.toContainText('not-persisted-in-the-catalogue');
  await expect(page.getByRole('link', { name: 'Example provider' })).toHaveAttribute('href', 'https://example.com/data');
  await page.getByRole('button', { name: 'New group' }).click();
  await expect(page.getByLabel('Group name')).toHaveValue('Group 1');
  await page.getByLabel('Group for Local test layer').selectOption({ label: 'Group 1' });
  await expect(page.locator('.catalog-section').filter({ has: page.getByLabel('Group name') }).getByText('Local test layer', { exact: true })).toBeVisible();
  await page.locator('#open-data-left').click();
  await page.getByRole('button', { name: /Raster tiles/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Comparison layer');
  await page.getByLabel('Service URL').fill('http://127.0.0.1:8014/other-missing/{z}/{x}/{y}.png');
  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.locator('#scene-layer-list').getByText('Comparison layer', { exact: true })).toBeVisible();
  const localLayer = page.locator('.catalog-layer').filter({ hasText: 'Local test layer' });
  const comparisonLayer = page.locator('.catalog-layer').filter({ hasText: 'Comparison layer' });
  const localLayerId = await localLayer.getAttribute('data-layer-id');
  const comparisonLayerId = await comparisonLayer.getAttribute('data-layer-id');
  await page.evaluate(({ sourceId, targetId }) => {
    const source = document.querySelector<HTMLElement>(`[data-layer-id="${sourceId}"]`)!;
    const target = document.querySelector<HTMLElement>(`[data-layer-id="${targetId}"]`)!;
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const bounds = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: bounds.top + 1 }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: bounds.top + 1 }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  }, { sourceId: localLayerId, targetId: comparisonLayerId });
  await expect(page.getByLabel('Group for Local test layer')).toHaveValue('');
  const ordering = await page.evaluate(() => {
    const debug = (window as any).__3dLodMVDebug;
    const rasterTopToBottom = debug.view.getLayers((layer: any) => layer.isColorLayer)
      .sort((a: any, b: any) => b.sequence - a.sequence)
      .map((layer: any) => layer.id);
    return { display: debug.layerOrder, rasterTopToBottom };
  });
  expect(ordering.rasterTopToBottom).toEqual(ordering.display.filter((id: string) => id !== 'cityjson-model'));
  expect(errors).toEqual([]);
});

for (const terrainFirst of [true, false]) {
  test(`drapes PNOA on IGN elevation when ${terrainFirst ? 'terrain' : 'imagery'} is added first`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 880, height: 540 });
    // RGB (1, 138, 136) encodes a known 100 m height in the IGN Terrain-RGB format.
    const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg7OoAAAGjARTOqORWAAAAAElFTkSuQmCC', 'base64');
    for (const host of ['gibs.earthdata.nasa.gov', 'xyz-mdt.idee.es', 'www.ign.es']) {
      await page.route(`https://${host}/**`, route => route.fulfill({ contentType: 'image/png', body: tile }));
    }
    await page.goto('/');
    await expect(page.getByLabel('Show NASA Blue Marble')).toBeVisible();
    await page.evaluate(async () => {
      const { view } = (window as any).__3dLodMVDebug;
      await view.controls.lookAtCoordinate({ coord: view.controls.getLookAtCoordinate(), range: 2500, tilt: 50 }, false);
    });
    await page.getByLabel('Show NASA Blue Marble').uncheck();
    const names = [/IGN Spain Terrain/, /PNOA Latest Orthophoto/];
    for (const name of terrainFirst ? names : names.reverse()) {
      await page.locator('#open-data-left').click();
      await page.getByRole('button', { name }).click();
      await expect(page.getByRole('checkbox', { name })).toBeChecked();
    }
    await expect.poll(() => page.evaluate(() => {
      const { view } = (window as any).__3dLodMVDebug;
      const ortho = view.getLayers().find((l: any) => l.id.includes('ign-pnoa'));
      let draped = false;
      view.tileLayer.object3d.traverse((node: any) => {
        if (!node.material?.visible || !ortho) return;
        const material = node.material;
        const elevation = material.getElevationTile?.();
        if (material.getTile?.(ortho.id)?.textures.some((t: any) => t?.isTexture) &&
            elevation?.textures.some((t: any) => t?.image?.data?.includes(100))) draped = true;
      });
      return draped;
    }), { timeout: 55000 }).toBe(true);
  });
}
