# 3dLodMV

3dLodMV is an open-source CityJSON viewer built with iTowns and Three.js. It brings the object inspection workflow of [3dLodViewer](https://github.com/Fran-4c4/3dLodViewer) to a geographic globe, where you can compare buildings with imagery, terrain and external GIS layers.

## Run the viewer

Use Node.js 24 with npm and a browser with WebGL support. From the repository root, run

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8012/`. Choose **Layers → Add data → Example dataset** to explore the bundled [two-building example](public/examples/demo.city.json), or choose **CityJSON file** to open a model from your device. Select **Objects** on the right, search for an ID and use its **i** button to inspect the attributes and relationships.

## Working with the globe

- **Local files.** The browser reads CityJSON and terrain files on your device. Model size is limited by browser memory. CityJSON needs a recognized EPSG identifier in `metadata.referenceSystem`. Supported systems include geographic WGS84, Web Mercator, ECEF and the registered Spanish and WGS84 UTM zones.
- **Map layers.** The globe opens with NASA GIBS Blue Marble imagery. Use Layers to hide or remove it, add XYZ/TMS, WMS or WMTS sources, drag raster layers into drawing order, create groups and adjust opacity. External layers request tiles directly from their providers. Provider attribution appears on the map. Optional bearer or query tokens are kept in memory for the session.
- **Terrain.** Open a local north-up GeoTIFF/COG or choose an IGN Spain or Mapzen preset. Each preset loads a fixed 3 × 3 tile patch around the model or camera target. CityJSON buildings retain their supplied elevations. Comparing building and terrain heights requires compatible vertical references.
- **Inspection.** Search by object ID or type, inspect source attributes, compare building colours, view statistics and save camera views for the session. Use **Measure from here** in the map context menu to compare approximate horizontal distance with straight-line 3D distance between successive points.

## Build and test

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The production build is written to `dist/`. Run `npm run preview` after the build to inspect it locally. The browser test starts its own server on port 8014.

## License and credits

3dLodMV is distributed under the [MIT License](LICENSE). Third-party libraries retain their own licenses. External imagery, elevation data and tile services are subject to their providers’ terms. See [third-party software and map credits](THIRD_PARTY.md).
