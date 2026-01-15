import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PlanetaryComputerControl } from '../../src/index';
import { LayerControl } from 'maplibre-gl-layer-control';
import '../../src/index.css';
import 'maplibre-gl-layer-control/style.css';

// Initialize map with CartoDB Positron basemap
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'carto-positron': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [
      {
        id: 'carto-positron',
        type: 'raster',
        source: 'carto-positron',
      },
    ],
  },
  center: [-122.4, 37.8],
  zoom: 9,
});

// Add navigation control
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Add Globe control
map.addControl(new maplibregl.GlobeControl(), 'top-right');

// Add Planetary Computer control when map loads
map.on('load', () => {
  // Add layer control
  const layerControl = new LayerControl({
    collapsed: true,
  });
  map.addControl(layerControl, 'top-right');

  const pcControl = new PlanetaryComputerControl({
    title: 'Planetary Computer',
    collapsed: false,
    panelWidth: 380,
  });

  map.addControl(pcControl, 'top-right');

  // Listen for events
  pcControl.on('layer:add', (event) => {
    console.log('Layer added:', event.data);
  });

  pcControl.on('search:complete', (event) => {
    console.log('Search completed:', event.state.searchResults.length, 'results');
  });

  pcControl.on('error', (event) => {
    console.error('Error:', event.state.error);
  });

  pcControl.on('collections:load', (event) => {
    console.log('Collections loaded:', event.state.collections.length);
  });

  // Expose control for debugging
  (window as unknown as { pcControl: PlanetaryComputerControl }).pcControl = pcControl;
});
