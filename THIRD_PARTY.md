# Third-party software

3dLodMV is MIT-licensed. Its dependencies retain their own licenses.

| Package | Version | License | Purpose |
|---|---:|---|---|
| iTowns | 2.46.0 | MIT or CeCILL-B | Globe, camera and geospatial layers |
| Three.js | 0.174.0 | MIT | WebGL scene and CityJSON geometry |
| Earcut | 3.2.4 | ISC | Polygon triangulation |
| Proj4js | 2.23.0 | MIT | Coordinate transformations used by iTowns |
| geotiff.js | 3.0.5 | MIT | In-browser GeoTIFF/COG decoding and resampling |
| Toastify JS | 1.12.0 | MIT | Transient completion and error notifications |

The authoritative notices and full dependency tree are distributed in each
installed package and recorded by `package-lock.json`.

## Design reference

The compact data-source dialog and typography scale refer to Kepler.gl's
MIT-licensed UI patterns and style tokens at revision
`229456eb089a2db71584c02ba39dce20bcc5b989`. Kepler.gl code is not bundled as a
runtime dependency.

## Map credits

The default globe requests Blue Marble Shaded Relief and Bathymetry from
[NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs). The viewer
displays a credit while the layer is visible.

Optional presets use [OpenStreetMap](https://www.openstreetmap.org/copyright),
[IGN/CNIG](https://www.ign.es/), [PNOA](https://pnoa.ign.es/) and
[Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
The [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
applies to requests to its public tile server. When adding a custom layer,
enter the attribution required by its provider.
