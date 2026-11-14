import { describe, it, expect, beforeEach } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { LayerManager } from '../src/lib/core/LayerManager';
import { TiTilerClient } from '../src/lib/api/titiler-client';
import type { STACCollection, STACItem } from '../src/lib/api/types';

/** Minimal in-memory stand-in for the parts of a MapLibre map the manager uses. */
class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  layers: Array<{ id: string; source: string; layout: Record<string, unknown>; paint: Record<string, unknown> }> = [];

  addSource(id: string, source: Record<string, unknown>) {
    if (this.sources.has(id)) throw new Error(`Source ${id} already exists`);
    this.sources.set(id, source);
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: FakeMap['layers'][number], beforeId?: string) {
    if (this.getLayer(layer.id)) throw new Error(`Layer ${layer.id} already exists`);
    const index = beforeId ? this.layers.findIndex((l) => l.id === beforeId) : -1;
    if (index >= 0) this.layers.splice(index, 0, layer);
    else this.layers.push(layer);
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((l) => l.id !== id);
  }
  getLayer(id: string) {
    return this.layers.find((l) => l.id === id);
  }
  getStyle() {
    return { layers: this.layers };
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    this.getLayer(id)!.layout[name] = value;
  }
  setPaintProperty(id: string, name: string, value: unknown) {
    this.getLayer(id)!.paint[name] = value;
  }
  order() {
    return this.layers.map((l) => l.id);
  }
}

const item = {
  id: 'S2_ITEM',
  type: 'Feature',
  stac_version: '1.0.0',
  geometry: { type: 'Point', coordinates: [0, 0] },
  bbox: [-123, 46.8, -121.5, 47.8],
  properties: { datetime: '2024-08-29T18:59:19Z' },
  links: [],
  assets: { visual: { href: 'https://example.test/visual.tif' } },
  collection: 'sentinel-2-l2a',
} as unknown as STACItem;

const collection = {
  id: 'sentinel-2-l2a',
  title: 'Sentinel-2 Level-2A',
  extent: { spatial: { bbox: [[-180, -90, 180, 90]] } },
} as unknown as STACCollection;

describe('LayerManager', () => {
  let map: FakeMap;
  let manager: LayerManager;

  beforeEach(() => {
    map = new FakeMap();
    manager = new LayerManager(map as unknown as MapLibreMap, new TiTilerClient('https://data.test'));
  });

  it('adds an item layer with the default preset and a TileJSON source', () => {
    const layer = manager.addItemLayer(item);

    expect(layer.id).toMatch(/^S2_ITEM-/);
    expect(layer.presetName).toBe('true-color');
    expect(layer.bounds).toEqual([-123, 46.8, -121.5, 47.8]);
    expect(map.getSource(layer.sourceId)?.url).toBe(
      'https://data.test/item/WebMercatorQuad/tilejson.json?collection=sentinel-2-l2a&item=S2_ITEM&assets=visual'
    );
  });

  it('restores a layer under a saved id, visibility, opacity, and position', () => {
    map.addSource('other', {});
    map.addLayer({ id: 'above', source: 'other', layout: {}, paint: {} });

    const layer = manager.addItemLayer(item, {
      id: 'saved-id',
      sourceId: 'saved-source',
      visible: false,
      opacity: 0.4,
      beforeId: 'above',
      renderParams: { expression: '(B08-B04)/(B08+B04)', asset_as_band: true, rescale: '-1,1' },
    });

    expect(layer.id).toBe('saved-id');
    expect(layer.sourceId).toBe('saved-source');
    expect(layer.assets).toEqual([]);
    expect(map.order()).toEqual(['saved-id', 'above']);
    expect(map.getLayer('saved-id')?.layout.visibility).toBe('none');
    expect(map.getLayer('saved-id')?.paint['raster-opacity']).toBe(0.4);
    expect(String(map.getSource('saved-source')?.url)).not.toContain('assets=');

    // Restoring the same id again replaces the layer instead of throwing.
    manager.addItemLayer(item, { id: 'saved-id', sourceId: 'saved-source' });
    expect(map.order()).toEqual(['above', 'saved-id']);
    expect(manager.getLayers()).toHaveLength(1);
  });

  it('adds a mosaic layer on the registered search tiles', () => {
    const layer = manager.addMosaicLayer(collection, 'pc1.search', {
      searchParams: { collections: ['sentinel-2-l2a'], datetime: '2024-06-01/2024-08-31' },
      bbox: [-123, 46, -121, 48],
    });

    expect(layer.type).toBe('mosaic');
    expect(layer.mosaicId).toBe('pc1.search');
    expect(layer.bounds).toEqual([-123, 46, -121, 48]);
    expect(map.getSource(layer.sourceId)?.tiles).toEqual([
      'https://data.test/mosaic/pc1.search/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a&assets=visual',
    ]);
  });

  it('restyles a layer in place without changing its position or state', () => {
    const bottom = manager.addItemLayer(item, { id: 'bottom' });
    manager.addItemLayer(item, { id: 'top' });
    manager.updateLayer('bottom', { visible: false, opacity: 0.5 });

    manager.updateLayer('bottom', {
      renderParams: { expression: '(B08-B04)/(B08+B04)', asset_as_band: true, colormap_name: 'rdylgn' },
      presetName: 'ndvi',
    });

    expect(map.order()).toEqual(['bottom', 'top']);
    const url = String(map.getSource(bottom.sourceId)?.url);
    expect(url).toContain('colormap_name=rdylgn');
    expect(url).toContain('asset_as_band=true');
    expect(url).not.toContain('assets=visual');
    expect(map.getLayer('bottom')?.layout.visibility).toBe('none');
    expect(map.getLayer('bottom')?.paint['raster-opacity']).toBe(0.5);
    expect(manager.getLayer('bottom')?.presetName).toBe('ndvi');

    // Dropping the colormap must really drop it (render params replace, not merge).
    manager.updateLayer('bottom', { renderParams: { assets: ['visual'] } });
    expect(String(map.getSource(bottom.sourceId)?.url)).not.toContain('colormap_name');
    expect(manager.getLayer('bottom')?.assets).toEqual(['visual']);
  });

  it('removes layers and their sources', () => {
    const layer = manager.addItemLayer(item);
    manager.removeLayer(layer.id);
    expect(map.order()).toEqual([]);
    expect(map.getSource(layer.sourceId)).toBeUndefined();
  });
});
