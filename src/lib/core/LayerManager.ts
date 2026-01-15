import type { Map as MapLibreMap } from 'maplibre-gl';
import type { STACItem, STACCollection, TileParams } from '../api/types';
import type { ActiveLayer } from './types';
import { TiTilerClient } from '../api/titiler-client';
import { getDefaultPreset } from '../api/render-presets';
import { generateId } from '../utils/helpers';

/**
 * Manages raster layers on the MapLibre map.
 * Handles adding, removing, and updating tile layers from Planetary Computer.
 */
export class LayerManager {
  private map: MapLibreMap;
  private tilerClient: TiTilerClient;
  private layers: Map<string, ActiveLayer> = new Map();

  /**
   * Creates a new layer manager.
   *
   * @param map - MapLibre GL map instance.
   * @param tilerClient - TiTiler API client.
   */
  constructor(map: MapLibreMap, tilerClient: TiTilerClient) {
    this.map = map;
    this.tilerClient = tilerClient;
  }

  /**
   * Adds a STAC item as a raster tile layer.
   *
   * @param item - STAC item to visualize.
   * @param options - Layer options.
   * @returns The created active layer configuration.
   */
  addItemLayer(
    item: STACItem,
    options?: {
      assets?: string[];
      renderParams?: TileParams;
      presetName?: string;
    }
  ): ActiveLayer {
    // Use item ID as layer name, sanitized for use as layer ID
    const sanitizedItemId = item.id.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
    const layerId = `${sanitizedItemId}-${generateId().slice(-6)}`;
    const sourceId = `${layerId}-source`;
    const collectionId = item.collection || '';

    // Get render params from preset or options
    let renderParams: TileParams = options?.renderParams || {};
    let presetName = options?.presetName;

    if (!options?.renderParams && !options?.assets && collectionId) {
      const defaultPreset = getDefaultPreset(collectionId);
      if (defaultPreset) {
        renderParams = defaultPreset.params;
        presetName = defaultPreset.name;
      }
    }

    // Determine assets to use
    const assets = options?.assets || renderParams.assets || this.getDefaultAssets(item);
    renderParams = { ...renderParams, assets };

    // Generate tile URL
    const tileUrl = this.tilerClient.getItemTileUrl(collectionId, item.id, renderParams);

    // Add source
    this.map.addSource(sourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      bounds: item.bbox as [number, number, number, number],
      attribution: 'Microsoft Planetary Computer',
    });

    // Add layer
    this.map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 1,
      },
    });

    const layer: ActiveLayer = {
      id: layerId,
      type: 'item',
      sourceId,
      item,
      collection: undefined,
      visible: true,
      opacity: 1,
      assets,
      renderParams,
      presetName,
    };

    this.layers.set(layerId, layer);
    return layer;
  }

  /**
   * Adds a collection mosaic as a raster tile layer.
   *
   * @param collection - STAC collection.
   * @param options - Layer options.
   * @returns The created active layer configuration.
   */
  addCollectionLayer(
    collection: STACCollection,
    options?: {
      assets?: string[];
      renderParams?: TileParams;
      bbox?: [number, number, number, number];
      presetName?: string;
    }
  ): ActiveLayer {
    // Use collection title or ID as layer name
    const collectionName = (collection.title || collection.id).replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
    const layerId = `${collectionName}-${generateId().slice(-6)}`;
    const sourceId = `${layerId}-source`;

    // Get render params from preset or options
    let renderParams: TileParams = options?.renderParams || {};
    let presetName = options?.presetName;

    if (!options?.renderParams && !options?.assets) {
      const defaultPreset = getDefaultPreset(collection.id);
      if (defaultPreset) {
        renderParams = defaultPreset.params;
        presetName = defaultPreset.name;
      }
    }

    // Determine assets
    const assets =
      options?.assets || renderParams.assets || this.getDefaultCollectionAssets(collection);
    renderParams = { ...renderParams, assets };

    // Generate tile URL
    const tileUrl = this.tilerClient.getCollectionTileUrl(collection.id, renderParams);

    // Get bounds
    const bounds = options?.bbox || this.getCollectionBounds(collection);

    // Add source
    this.map.addSource(sourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      bounds,
      attribution: 'Microsoft Planetary Computer',
    });

    // Add layer
    this.map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 1,
      },
    });

    const layer: ActiveLayer = {
      id: layerId,
      type: 'collection',
      sourceId,
      collection,
      visible: true,
      opacity: 1,
      assets,
      renderParams,
      presetName,
    };

    this.layers.set(layerId, layer);
    return layer;
  }

  /**
   * Removes a layer from the map.
   *
   * @param layerId - Layer identifier.
   */
  removeLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    // Remove layer from map
    if (this.map.getLayer(layerId)) {
      this.map.removeLayer(layerId);
    }

    // Remove source from map
    if (this.map.getSource(layer.sourceId)) {
      this.map.removeSource(layer.sourceId);
    }

    this.layers.delete(layerId);
  }

  /**
   * Updates layer properties.
   *
   * @param layerId - Layer identifier.
   * @param updates - Properties to update.
   */
  updateLayer(layerId: string, updates: Partial<ActiveLayer>): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    // Update visibility
    if (updates.visible !== undefined) {
      this.map.setLayoutProperty(layerId, 'visibility', updates.visible ? 'visible' : 'none');
    }

    // Update opacity
    if (updates.opacity !== undefined) {
      this.map.setPaintProperty(layerId, 'raster-opacity', updates.opacity);
    }

    // Update render params (requires recreating the source)
    if (updates.renderParams || updates.assets) {
      this.updateLayerSource(layerId, updates);
    }

    // Update internal state
    this.layers.set(layerId, { ...layer, ...updates });
  }

  /**
   * Gets a layer by ID.
   *
   * @param layerId - Layer identifier.
   * @returns The layer configuration or undefined.
   */
  getLayer(layerId: string): ActiveLayer | undefined {
    return this.layers.get(layerId);
  }

  /**
   * Gets all active layers.
   *
   * @returns Array of active layers.
   */
  getLayers(): ActiveLayer[] {
    return Array.from(this.layers.values());
  }

  /**
   * Removes all layers managed by this instance.
   */
  removeAllLayers(): void {
    for (const layerId of this.layers.keys()) {
      this.removeLayer(layerId);
    }
  }

  /**
   * Zooms the map to a layer's bounds.
   *
   * @param layerId - Layer identifier.
   */
  zoomToLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    let bounds: [number, number, number, number] | undefined;

    if (layer.item?.bbox) {
      bounds = layer.item.bbox as [number, number, number, number];
    } else if (layer.collection) {
      bounds = this.getCollectionBounds(layer.collection);
    }

    if (bounds) {
      this.map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 50 }
      );
    }
  }

  /**
   * Gets the map instance.
   *
   * @returns The MapLibre GL map.
   */
  getMap(): MapLibreMap {
    return this.map;
  }

  /**
   * Updates a layer's tile source with new render params.
   *
   * @param layerId - Layer identifier.
   * @param updates - Updates including new render params.
   */
  private updateLayerSource(layerId: string, updates: Partial<ActiveLayer>): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    const newParams = { ...layer.renderParams, ...updates.renderParams };
    const newAssets = updates.assets || layer.assets;

    let tileUrl: string;

    if (layer.type === 'item' && layer.item) {
      const collectionId = layer.item.collection || '';
      tileUrl = this.tilerClient.getItemTileUrl(collectionId, layer.item.id, {
        ...newParams,
        assets: newAssets,
      });
    } else if (layer.type === 'collection' && layer.collection) {
      tileUrl = this.tilerClient.getCollectionTileUrl(layer.collection.id, {
        ...newParams,
        assets: newAssets,
      });
    } else {
      return;
    }

    // Get current layer state
    const visibility = this.map.getLayoutProperty(layerId, 'visibility');
    const opacity = this.map.getPaintProperty(layerId, 'raster-opacity');

    // Remove old layer and source
    this.map.removeLayer(layerId);
    this.map.removeSource(layer.sourceId);

    // Get bounds
    const bounds = layer.item?.bbox || (layer.collection ? this.getCollectionBounds(layer.collection) : undefined);

    // Add new source
    this.map.addSource(layer.sourceId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      bounds: bounds as [number, number, number, number] | undefined,
      attribution: 'Microsoft Planetary Computer',
    });

    // Add new layer
    this.map.addLayer({
      id: layerId,
      type: 'raster',
      source: layer.sourceId,
      layout: {
        visibility: visibility as 'visible' | 'none' | undefined,
      },
      paint: {
        'raster-opacity': (opacity as number) ?? 1,
      },
    });
  }

  /**
   * Gets default assets for a STAC item.
   *
   * @param item - STAC item.
   * @returns Array of asset names.
   */
  private getDefaultAssets(item: STACItem): string[] {
    // Prioritize common renderable assets
    const preferredAssets = ['visual', 'data', 'image', 'cog_default'];
    for (const asset of preferredAssets) {
      if (item.assets[asset]) return [asset];
    }
    // Look for any COG or data asset
    for (const [key, asset] of Object.entries(item.assets)) {
      const type = asset.type || '';
      if (type.includes('tiff') || type.includes('geotiff') || type.includes('cog')) {
        return [key];
      }
    }
    // Return first asset (excluding thumbnail/overview/metadata)
    const excludePatterns = ['thumbnail', 'overview', 'metadata', 'tilejson', 'rendered_preview'];
    const dataAsset = Object.keys(item.assets).find(
      (key) => !excludePatterns.some((p) => key.toLowerCase().includes(p))
    );
    return dataAsset ? [dataAsset] : [];
  }

  /**
   * Gets default assets for a collection.
   *
   * @param collection - STAC collection.
   * @returns Array of asset names.
   */
  private getDefaultCollectionAssets(collection: STACCollection): string[] {
    const itemAssets = collection.item_assets || {};
    // Prioritize common renderable assets
    const preferredAssets = ['visual', 'data', 'image', 'cog_default'];
    for (const asset of preferredAssets) {
      if (itemAssets[asset]) return [asset];
    }
    // Look for any COG or data asset
    for (const [key, asset] of Object.entries(itemAssets)) {
      const type = asset.type || '';
      if (type.includes('tiff') || type.includes('geotiff') || type.includes('cog')) {
        return [key];
      }
    }
    // Return first asset (excluding thumbnail/overview/metadata)
    const excludePatterns = ['thumbnail', 'overview', 'metadata', 'tilejson', 'rendered_preview'];
    const dataAsset = Object.keys(itemAssets).find(
      (key) => !excludePatterns.some((p) => key.toLowerCase().includes(p))
    );
    return dataAsset ? [dataAsset] : [];
  }

  /**
   * Gets bounds from a collection's extent.
   *
   * @param collection - STAC collection.
   * @returns Bounding box or undefined.
   */
  private getCollectionBounds(
    collection: STACCollection
  ): [number, number, number, number] | undefined {
    const bbox = collection.extent?.spatial?.bbox?.[0];
    if (bbox && bbox.length >= 4) {
      return [bbox[0], bbox[1], bbox[2], bbox[3]];
    }
    return undefined;
  }
}
