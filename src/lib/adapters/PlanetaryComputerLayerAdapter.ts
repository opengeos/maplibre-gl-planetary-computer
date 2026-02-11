import type { CustomLayerAdapter, LayerState } from 'maplibre-gl-layer-control';
import type { PlanetaryComputerControl } from '../core/PlanetaryComputerControl';

/**
 * Adapter for integrating Planetary Computer raster layers with maplibre-gl-layer-control.
 *
 * @example
 * ```typescript
 * import { PlanetaryComputerControl, PlanetaryComputerLayerAdapter } from 'maplibre-gl-planetary-computer';
 * import { LayerControl } from 'maplibre-gl-layer-control';
 *
 * const pcControl = new PlanetaryComputerControl({ ... });
 * map.addControl(pcControl, 'top-right');
 *
 * const pcAdapter = new PlanetaryComputerLayerAdapter(pcControl);
 * const layerControl = new LayerControl({
 *   customLayerAdapters: [pcAdapter],
 * });
 * map.addControl(layerControl, 'top-left');
 * ```
 */
export class PlanetaryComputerLayerAdapter implements CustomLayerAdapter {
  readonly type = 'planetary-computer';

  private _control: PlanetaryComputerControl;
  private _changeCallbacks: Array<(event: 'add' | 'remove', layerId: string) => void> = [];
  private _unsubscribe?: () => void;

  constructor(control: PlanetaryComputerControl) {
    this._control = control;
    this._setupEventListeners();
  }

  private _setupEventListeners(): void {
    const handleLayerAdd = () => {
      const state = this._control.getState();
      const layers = state.activeLayers;
      if (layers.length > 0) {
        const lastLayer = layers[layers.length - 1];
        this._changeCallbacks.forEach((cb) => cb('add', lastLayer.id));
      }
    };

    const handleLayerRemove = () => {
      // We need to detect which layer was removed by comparing current state
      // The event fires after removal, so we notify with a general refresh
      // The layer control will reconcile by calling getLayerIds()
      this._changeCallbacks.forEach((cb) => cb('remove', ''));
    };

    this._control.on('layer:add', handleLayerAdd);
    this._control.on('layer:remove', handleLayerRemove);

    this._unsubscribe = () => {
      this._control.off('layer:add', handleLayerAdd);
      this._control.off('layer:remove', handleLayerRemove);
    };
  }

  getLayerIds(): string[] {
    const state = this._control.getState();
    return state.activeLayers.map((l) => l.id);
  }

  getLayerState(layerId: string): LayerState | null {
    const state = this._control.getState();
    const layer = state.activeLayers.find((l) => l.id === layerId);
    if (!layer) return null;

    return {
      visible: layer.visible,
      opacity: layer.opacity,
      name: this.getName(layerId),
      isCustomLayer: true,
      customLayerType: 'planetary-computer',
    };
  }

  setVisibility(layerId: string, visible: boolean): void {
    this._control.updateLayer(layerId, { visible });
  }

  setOpacity(layerId: string, opacity: number): void {
    this._control.updateLayer(layerId, { opacity });
  }

  getName(layerId: string): string {
    const state = this._control.getState();
    const layer = state.activeLayers.find((l) => l.id === layerId);
    if (layer) {
      if (layer.item) {
        return layer.item.id;
      }
      if (layer.collection) {
        return layer.collection.title || layer.collection.id;
      }
    }
    return layerId;
  }

  getSymbolType(_layerId: string): string {
    return 'raster';
  }

  removeLayer(layerId: string): void {
    this._control.removeLayer(layerId);
  }

  onLayerChange(callback: (event: 'add' | 'remove', layerId: string) => void): () => void {
    this._changeCallbacks.push(callback);
    return () => {
      const idx = this._changeCallbacks.indexOf(callback);
      if (idx >= 0) this._changeCallbacks.splice(idx, 1);
    };
  }

  destroy(): void {
    this._unsubscribe?.();
    this._changeCallbacks = [];
  }
}
