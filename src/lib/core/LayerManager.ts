import type { Map as MapLibreMap, RasterSourceSpecification } from 'maplibre-gl';
import type { STACItem, STACCollection, TileParams } from '../api/types';
import type {
  ActiveLayer,
  AddItemLayerOptions,
  AddMosaicLayerOptions,
  LayerPlacementOptions,
} from './types';
import { TiTilerClient } from '../api/titiler-client';
import { getDefaultPreset } from '../api/render-presets';
import { generateId } from '../utils/helpers';

/**
 * Reduces a STAC bbox (2D or 3D) to a 2D [west, south, east, north] tuple.
 *
 * @param bbox - STAC bbox with 4 or 6 numbers.
 * @returns The 2D bounds, or undefined when the bbox is missing or malformed.
 */
function toBounds(bbox?: number[]): [number, number, number, number] | undefined {
  if (!Array.isArray(bbox) || !bbox.every((value) => Number.isFinite(value))) return undefined;
  if (bbox.length === 4) return [bbox[0], bbox[1], bbox[2], bbox[3]];
  if (bbox.length === 6) return [bbox[0], bbox[1], bbox[3], bbox[4]];
  return undefined;
}

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
   * @param options - Layer options. Pass `id` to restore a saved layer under its original id.
   * @returns The created active layer configuration.
   */
  addItemLayer(item: STACItem, options?: AddItemLayerOptions): ActiveLayer {
    const collectionId = item.collection || '';
    const { layerId, sourceId } = this.resolveLayerIds(item.id, options);

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

    // Determine assets to use. An expression names its own assets.
    const assets =
      options?.assets ||
      renderParams.assets ||
      (renderParams.expression ? [] : this.getDefaultAssets(item));
    renderParams = assets.length ? { ...renderParams, assets } : { ...renderParams };

    const bounds = toBounds(item.bbox);
    const layer: ActiveLayer = {
      id: layerId,
      type: 'item',
      sourceId,
      item,
      collection: undefined,
      visible: options?.visible ?? true,
      opacity: options?.opacity ?? 1,
      assets,
      renderParams,
      presetName,
      ...(bounds ? { bounds } : {}),
    };

    this.addMapLayer(layer, options?.beforeId);
    this.layers.set(layerId, layer);
    return layer;
  }

  /**
   * Adds a registered mosaic as a raster tile layer.
   *
   * The mosaic must already be registered with
   * {@link TiTilerClient.registerMosaic}; `mosaicId` is the returned search id.
   *
   * @param collection - STAC collection the mosaic draws from.
   * @param mosaicId - Registered search id.
   * @param options - Layer options. Pass `id` to restore a saved layer under its original id.
   * @returns The created active layer configuration.
   */
  addMosaicLayer(
    collection: STACCollection,
    mosaicId: string,
    options?: AddMosaicLayerOptions
  ): ActiveLayer {
    const { layerId, sourceId } = this.resolveLayerIds(collection.title || collection.id, options);

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

    // Determine assets. An expression names its own assets.
    const assets =
      options?.assets ||
      renderParams.assets ||
      (renderParams.expression ? [] : this.getDefaultCollectionAssets(collection));
    renderParams = assets.length ? { ...renderParams, assets } : { ...renderParams };

    const bounds = options?.bbox || this.getCollectionBounds(collection);
    const layer: ActiveLayer = {
      id: layerId,
      type: 'mosaic',
      sourceId,
      collection,
      mosaicId,
      searchParams: options?.searchParams,
      visible: options?.visible ?? true,
      opacity: options?.opacity ?? 1,
      assets,
      renderParams,
      presetName,
      ...(bounds ? { bounds } : {}),
    };

    this.addMapLayer(layer, options?.beforeId);
    this.layers.set(layerId, layer);
    return layer;
  }

  /**
   * Resolves the layer and source ids for a new layer, removing any map
   * layer/source that already uses a requested id so a restore is idempotent.
   *
   * @param label - Human-readable name the generated id is derived from.
   * @param options - Placement options that may carry explicit ids.
   * @returns The layer and source ids to use.
   */
  private resolveLayerIds(
    label: string,
    options?: LayerPlacementOptions
  ): { layerId: string; sourceId: string } {
    const sanitized = label.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
    const layerId = options?.id || `${sanitized}-${generateId().slice(-6)}`;
    const sourceId = options?.sourceId || `${layerId}-source`;

    if (this.layers.has(layerId)) {
      this.removeLayer(layerId);
    }
    if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);

    return { layerId, sourceId };
  }

  /**
   * Builds the MapLibre raster source for a layer from its current render state.
   *
   * @param layer - Layer configuration.
   * @returns The raster source specification.
   */
  private buildSource(layer: ActiveLayer): RasterSourceSpecification {
    const params = layer.assets.length
      ? { ...layer.renderParams, assets: layer.assets }
      : layer.renderParams;
    const common = {
      type: 'raster' as const,
      tileSize: params.tile_size || 256,
      ...(layer.bounds ? { bounds: layer.bounds } : {}),
      attribution: 'Microsoft Planetary Computer',
    };

    if (layer.type === 'item' && layer.item) {
      return {
        ...common,
        url: this.tilerClient.getItemTileJSONUrl(layer.item.collection || '', layer.item.id, params),
      };
    }

    if (layer.type === 'mosaic' && layer.mosaicId) {
      return {
        ...common,
        tiles: [this.tilerClient.getMosaicTileUrl(layer.mosaicId, params, layer.collection?.id)],
        ...(params.minzoom !== undefined ? { minzoom: params.minzoom } : {}),
        ...(params.maxzoom !== undefined ? { maxzoom: params.maxzoom } : {}),
      };
    }

    throw new Error(`Layer '${layer.id}' has no item or registered mosaic to render`);
  }

  /**
   * Adds the MapLibre source and layer for a layer configuration.
   *
   * @param layer - Layer configuration.
   * @param beforeId - Existing map layer to insert before, when it still exists.
   */
  private addMapLayer(layer: ActiveLayer, beforeId?: string): void {
    this.map.addSource(layer.sourceId, this.buildSource(layer));
    this.map.addLayer(
      {
        id: layer.id,
        type: 'raster',
        source: layer.sourceId,
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
        },
        paint: {
          'raster-opacity': layer.opacity,
        },
      },
      beforeId && this.map.getLayer(beforeId) ? beforeId : undefined
    );
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
   * Changing `renderParams`, `assets`, or `mosaicId` rebuilds the tile source.
   * `renderParams` replaces the previous parameters rather than merging, so a
   * restyle can drop a parameter (for example a colormap).
   *
   * @param layerId - Layer identifier.
   * @param updates - Properties to update.
   */
  updateLayer(layerId: string, updates: Partial<ActiveLayer>): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    const next: ActiveLayer = { ...layer, ...updates };
    const restyled =
      updates.renderParams !== undefined ||
      updates.assets !== undefined ||
      updates.mosaicId !== undefined;

    if (restyled) {
      if (updates.assets === undefined && updates.renderParams !== undefined) {
        // An expression names its own assets; otherwise keep the previous ones
        // unless the new parameters bring their own.
        next.assets = next.renderParams.expression
          ? next.renderParams.assets || []
          : next.renderParams.assets || layer.assets;
      }
      next.renderParams = next.assets.length
        ? { ...next.renderParams, assets: next.assets }
        : { ...next.renderParams };
      if (!next.assets.length) delete next.renderParams.assets;
      this.rebuildLayerSource(next);
    } else if (this.map.getLayer(layerId)) {
      if (updates.visible !== undefined) {
        this.map.setLayoutProperty(layerId, 'visibility', updates.visible ? 'visible' : 'none');
      }
      if (updates.opacity !== undefined) {
        this.map.setPaintProperty(layerId, 'raster-opacity', updates.opacity);
      }
    }

    this.layers.set(layerId, next);
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

    const bounds =
      layer.bounds ||
      toBounds(layer.item?.bbox) ||
      (layer.collection ? this.getCollectionBounds(layer.collection) : undefined);

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
   * Rebuilds a layer's tile source after its render state changed, keeping
   * the layer's position in the map's layer order.
   *
   * @param layer - Layer configuration with the new render state already applied.
   */
  private rebuildLayerSource(layer: ActiveLayer): void {
    const styleLayers = this.map.getStyle()?.layers ?? [];
    const index = styleLayers.findIndex((styleLayer) => styleLayer.id === layer.id);
    const beforeId = index >= 0 ? styleLayers[index + 1]?.id : undefined;

    if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
    if (this.map.getSource(layer.sourceId)) this.map.removeSource(layer.sourceId);

    this.addMapLayer(layer, beforeId);
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
