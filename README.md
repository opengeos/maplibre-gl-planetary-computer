# MapLibre GL Planetary Computer

[![npm version](https://badge.fury.io/js/maplibre-gl-planetary-computer.svg)](https://www.npmjs.com/package/maplibre-gl-planetary-computer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open in CodeSandbox](https://img.shields.io/badge/Open%20in-CodeSandbox-blue?logo=codesandbox)](https://codesandbox.io/p/github/opengeos/maplibre-gl-planetary-computer)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-blue?logo=stackblitz)](https://stackblitz.com/github/opengeos/maplibre-gl-planetary-computer)

A MapLibre GL JS plugin for searching, visualizing, and downloading data from Microsoft Planetary Computer's Earth observation catalog.

## Features

- **Browse 150+ Collections** - Access Sentinel-2, Landsat, NAIP, DEM, and more
- **Search & Filter** - Search by location (bbox), date range, and collection
- **Visualize on Map** - Add raster tiles directly to MapLibre with render presets
- **Mosaics** - Composite every item in a date range (and cloud cover limit) into one seamless layer
- **Restyle Layers** - Switch preset, colormap, rescale, or band math on a layer already on the map
- **Inspect & Clip** - Query pixel values of item and mosaic layers, and clip an item to a GeoTIFF
- **Extensible** - Add your own buttons to the panel and restore layers from a saved project
- **Download Data** - Get signed URLs to download original data assets
- **TypeScript Support** - Full type definitions included
- **React Integration** - Component wrapper and hooks for React apps

## Installation

```bash
npm install maplibre-gl-planetary-computer maplibre-gl
```

## Quick Start

### Vanilla JavaScript/TypeScript

```typescript
import maplibregl from 'maplibre-gl';
import { PlanetaryComputerControl } from 'maplibre-gl-planetary-computer';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'maplibre-gl-planetary-computer/style.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-122.4, 37.8],
  zoom: 9,
});

map.on('load', () => {
  const control = new PlanetaryComputerControl({
    title: 'Earth Data',
    collapsed: false,
  });

  map.addControl(control, 'top-right');

  // Listen for events
  control.on('layer:add', (event) => {
    console.log('Layer added:', event.data);
  });
});
```

### React

```tsx
import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { PlanetaryComputerControlReact } from 'maplibre-gl-planetary-computer/react';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'maplibre-gl-planetary-computer/style.css';

function App() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-122.4, 37.8],
      zoom: 9,
    });

    mapInstance.on('load', () => setMap(mapInstance));

    return () => mapInstance.remove();
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {map && (
        <PlanetaryComputerControlReact
          map={map}
          title="Earth Data"
          onLayerAdd={(layer) => console.log('Added:', layer)}
        />
      )}
    </div>
  );
}
```

## API Reference

### PlanetaryComputerControl

Main control class implementing MapLibre's IControl interface.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collapsed` | `boolean` | `true` | Start with panel collapsed |
| `position` | `string` | `'top-right'` | Control position on map |
| `title` | `string` | `'Planetary Computer'` | Panel title |
| `panelWidth` | `number` | `380` | Panel width in pixels |
| `maxHeight` | `number` | `0` | Max panel height in pixels; `0` fills the available map height |
| `stacApiUrl` | `string` | PC default | STAC API base URL |
| `tilerApiUrl` | `string` | PC default | TiTiler API base URL |
| `maxSearchResults` | `number` | `50` | Max items per search |
| `autoLoadCollections` | `boolean` | `true` | Load collections on init |
| `stacClient` | `STACClient` | built from `stacApiUrl` | Use your own configured STAC client (custom fetch, collection fallback, search method) |
| `tilerClient` | `TiTilerClient` | built from `tilerApiUrl` | Use your own TiTiler client |
| `customActions` | `PlanetaryComputerCustomActions` | none | Extra buttons for the search, results, item, and layer views |

#### Methods

```typescript
// Panel control
control.toggle()                    // Toggle panel visibility
control.expand()                    // Expand panel
control.collapse()                  // Collapse panel
control.getState()                  // Get current state

// Data operations
await control.loadCollections()     // Load all collections
await control.search(params)        // Search for items
control.selectCollection(collection) // Select a collection
control.selectItem(item)            // Select an item

// Layer management
control.addItemLayer(item, options)        // Add item as layer
await control.addMosaicLayer(collection, { // Composite many items into one layer
  searchParams: {
    datetime: '2024-06-01T00:00:00Z/2024-08-31T23:59:59Z',
    query: { 'eo:cloud_cover': { lte: 10 } },
  },
})
control.removeLayer(layerId)               // Remove layer
control.updateLayer(layerId, updates)      // Update visibility, opacity, or restyle (renderParams)
control.zoomToLayer(layerId)               // Zoom to layer
await control.queryLayerPoint(layerId, lon, lat) // Pixel values of an item or mosaic layer
control.getItemClipUrl(item, renderParams, bbox) // GeoTIFF clip URL (raw band values)

// API clients used by the control
control.getStacClient()
control.getTilerClient()

// Downloads
await control.getDownloadUrl(item, assetKey) // Get signed URL

// Events
control.on(event, handler)          // Subscribe to event
control.off(event, handler)         // Unsubscribe from event
```

#### Restoring saved layers

`addItemLayer` and `addMosaicLayer` accept `id`, `sourceId`, `visible`, `opacity`,
and `beforeId`, so a host application can re-create layers from a saved project
under their original ids:

```typescript
const item = await control.getStacClient().getItem('sentinel-2-l2a', saved.itemId);
control.addItemLayer(item, {
  id: saved.id,
  sourceId: saved.sourceId,
  visible: saved.visible,
  opacity: saved.opacity,
  renderParams: saved.renderParams,
  presetName: saved.presetName,
});
```

A mosaic's search id is not permanent. Save the layer's `searchParams` and pass
them back to `addMosaicLayer`, which registers the search again.

#### Custom actions

Add your own buttons to the panel to hand data to the rest of your application:

```typescript
const control = new PlanetaryComputerControl({
  customActions: {
    results: [
      {
        id: 'animate',
        label: 'Animate',
        isAvailable: ({ items }) => items.length > 1,
        onClick: ({ items }) => myApp.animate(items),
      },
    ],
    layer: [{ id: 'chart', label: 'Chart', onClick: ({ layer }) => myApp.chart(layer) }],
  },
});
```

`search` actions receive the collection and the form's search parameters,
`results` actions the returned items, `item` actions the item with the render
parameters chosen in the form, and `layer` actions the active layer.

#### Events

| Event | Description |
|-------|-------------|
| `collapse` | Panel collapsed |
| `expand` | Panel expanded |
| `statechange` | State changed |
| `collections:load` | Collections loaded |
| `search:start` | Search started |
| `search:complete` | Search completed |
| `search:error` | Search failed |
| `layer:add` | Layer added |
| `layer:remove` | Layer removed |
| `layer:update` | Layer updated |
| `item:select` | Item selected |
| `collection:select` | Collection selected |
| `error` | Error occurred |

### React Hook: usePlanetaryComputer

```tsx
import { usePlanetaryComputer } from 'maplibre-gl-planetary-computer/react';

function MyComponent() {
  const {
    collections,      // Available collections
    loading,          // Loading state
    error,            // Error state
    loadCollections,  // Load collections
    search,           // Search for items
    getItemTileUrl,   // Get tile URL for item
    getDownloadUrl,   // Get signed download URL
  } = usePlanetaryComputer();

  const handleSearch = async () => {
    const items = await search({
      collections: ['sentinel-2-l2a'],
      bbox: [-122.5, 37.5, -122, 38],
      datetime: '2024-01-01/2024-12-31',
    });
    console.log('Found:', items.length);
  };

  return <button onClick={handleSearch}>Search</button>;
}
```

### Standalone API Clients

You can also use the API clients directly:

```typescript
import { STACClient, TiTilerClient, SASTokenManager } from 'maplibre-gl-planetary-computer';

// STAC API. Search uses GET by default, which needs no CORS preflight;
// pass { searchMethod: 'POST' } for very large intersects geometries.
const stac = new STACClient();
const collections = await stac.getCollections();
const items = await stac.search({
  collections: ['sentinel-2-l2a'],
  bbox: [-122.5, 37.5, -122, 38],
});

// TiTiler for tiles
const tiler = new TiTilerClient();
const tileUrl = tiler.getItemTileUrl('sentinel-2-l2a', 'item-id', {
  assets: ['visual'],
});

// Mosaic of every matching item
const { tileUrl: mosaicUrl } = await tiler.registerMosaic(
  { collections: ['sentinel-2-l2a'], datetime: '2024-06-01T00:00:00Z/2024-08-31T23:59:59Z' },
  { assets: ['visual'] }
);

// SAS tokens for downloads
const sas = new SASTokenManager();
const signedUrl = await sas.signUrl(assetUrl, 'sentinel-2-l2a');
```

## Render Presets

The plugin includes built-in render presets for common collections:

| Collection | Presets |
|------------|---------|
| `sentinel-2-l2a` | True Color, False Color, NDVI, NDWI, NBR, NDBI, SWIR |
| `landsat-c2-l2` | True Color, False Color, NDVI, NDWI, NBR, Thermal |
| `naip` | RGB, Color Infrared, NDVI |
| `cop-dem-glo-30/90` | Elevation, Hillshade |

```typescript
import { getPresetsForCollection, getDefaultPreset } from 'maplibre-gl-planetary-computer';

const presets = getPresetsForCollection('sentinel-2-l2a');
const defaultPreset = getDefaultPreset('sentinel-2-l2a');
```

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build library
npm run build

# Build examples for deployment
npm run build:examples
```

## Docker

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/opengeos/maplibre-gl-planetary-computer:latest

# Run locally
docker run -p 8080:80 ghcr.io/opengeos/maplibre-gl-planetary-computer:latest

# Open http://localhost:8080/maplibre-gl-planetary-computer/
```

## Project Structure

```
maplibre-gl-planetary-computer/
├── src/
│   ├── lib/
│   │   ├── api/          # STAC, TiTiler, SAS clients
│   │   ├── core/         # Main control classes
│   │   ├── hooks/        # React hooks
│   │   ├── styles/       # CSS styles
│   │   └── utils/        # Utility functions
│   ├── index.ts          # Main entry
│   └── react.ts          # React entry
├── examples/
│   ├── basic/            # Vanilla TypeScript example
│   └── react/            # React example
├── tests/
└── dist/                 # Built library
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/opengeos/maplibre-gl-planetary-computer)
- [npm Package](https://www.npmjs.com/package/maplibre-gl-planetary-computer)
- [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
