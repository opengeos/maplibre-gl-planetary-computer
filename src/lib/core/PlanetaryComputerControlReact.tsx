import { useEffect, useRef } from 'react';
import { PlanetaryComputerControl } from './PlanetaryComputerControl';
import type { PlanetaryComputerReactProps } from './types';

/**
 * React wrapper component for PlanetaryComputerControl.
 * Manages lifecycle and provides React-friendly event handling.
 *
 * @example
 * ```tsx
 * function App() {
 *   const [map, setMap] = useState<Map | null>(null);
 *
 *   return (
 *     <>
 *       <div ref={mapRef} />
 *       {map && (
 *         <PlanetaryComputerControlReact
 *           map={map}
 *           title="Earth Data"
 *           onLayerAdd={(layer) => console.log('Added:', layer)}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 */
export function PlanetaryComputerControlReact({
  map,
  onStateChange,
  onLayerAdd,
  onLayerRemove,
  onSearch,
  onItemSelect,
  onError,
  position = 'top-right',
  ...options
}: PlanetaryComputerReactProps): null {
  const controlRef = useRef<PlanetaryComputerControl | null>(null);

  useEffect(() => {
    if (!map) return;

    // Create control instance
    const control = new PlanetaryComputerControl(options);
    controlRef.current = control;

    // Register event handlers
    if (onStateChange) {
      control.on('statechange', (e) => onStateChange(e.state));
    }

    if (onLayerAdd) {
      control.on('layer:add', (e) => {
        const layers = e.state.activeLayers;
        if (layers.length > 0) {
          onLayerAdd(layers[layers.length - 1]);
        }
      });
    }

    if (onLayerRemove) {
      control.on('layer:remove', (e) => {
        onLayerRemove(e.data as string);
      });
    }

    if (onSearch) {
      control.on('search:complete', (e) => {
        onSearch(e.state.searchParams, e.state.searchResults);
      });
    }

    if (onItemSelect) {
      control.on('item:select', (e) => {
        if (e.state.selectedItem) {
          onItemSelect(e.state.selectedItem);
        }
      });
    }

    if (onError) {
      control.on('error', (e) => {
        if (e.state.error) {
          onError(new Error(e.state.error));
        }
      });
    }

    // Add control to map
    map.addControl(control, position);

    // Cleanup on unmount
    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  // Handle collapsed prop changes
  useEffect(() => {
    if (controlRef.current && options.collapsed !== undefined) {
      const state = controlRef.current.getState();
      if (options.collapsed !== state.collapsed) {
        controlRef.current.toggle();
      }
    }
  }, [options.collapsed]);

  // This component renders nothing - the control manages its own DOM
  return null;
}
