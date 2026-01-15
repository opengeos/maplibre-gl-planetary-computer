import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  PlanetaryComputerControlReact,
  usePlanetaryComputer,
} from '../../src/react';
import { LayerControl } from 'maplibre-gl-layer-control';
import '../../src/index.css';
import 'maplibre-gl-layer-control/style.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { collections, loading, error } = usePlanetaryComputer({
    autoLoadCollections: false,
  });

  // Initialize map with CartoDB Positron basemap
  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
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

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add layer control
    const layerControl = new LayerControl({
      collapsed: true,
    });
    mapInstance.addControl(layerControl, 'top-left');

    mapInstance.on('load', () => {
      setMap(mapInstance);
    });

    return () => {
      mapInstance.remove();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {map && (
        <PlanetaryComputerControlReact
          map={map}
          title="Planetary Computer"
          collapsed={false}
          position="top-right"
          onStateChange={(state) => {
            console.log('State changed:', state.activeView);
          }}
          onSearch={(params, results) => {
            console.log('Search:', params.collections, '-', results.length, 'results');
          }}
          onLayerAdd={(layer) => {
            console.log('Layer added:', layer.id);
          }}
          onError={(error) => {
            console.error('Error:', error.message);
          }}
        />
      )}

      {/* Status indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          background: 'white',
          padding: '8px 12px',
          borderRadius: 4,
          fontSize: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {loading ? 'Loading...' : error ? `Error: ${error.message}` : 'Ready'}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
