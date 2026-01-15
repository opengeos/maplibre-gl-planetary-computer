import type { CollectionRenderConfig, RenderPreset } from './types';

/**
 * Render presets for Sentinel-2 L2A collection.
 */
const sentinel2L2aPresets: RenderPreset[] = [
  {
    name: 'true-color',
    label: 'True Color',
    description: 'Natural color composite (RGB)',
    params: {
      assets: ['visual'],
    },
  },
  {
    name: 'false-color',
    label: 'False Color (Vegetation)',
    description: 'NIR-Red-Green composite for vegetation analysis',
    params: {
      assets: ['B08', 'B04', 'B03'],
      rescale: '0,3000',
    },
  },
  {
    name: 'ndvi',
    label: 'NDVI',
    description: 'Normalized Difference Vegetation Index',
    params: {
      expression: '(B08-B04)/(B08+B04)',
      rescale: '-1,1',
      colormap_name: 'rdylgn',
    },
  },
  {
    name: 'ndwi',
    label: 'NDWI',
    description: 'Normalized Difference Water Index',
    params: {
      expression: '(B03-B08)/(B03+B08)',
      rescale: '-1,1',
      colormap_name: 'blues',
    },
  },
  {
    name: 'swir',
    label: 'SWIR Composite',
    description: 'SWIR-NIR-Red for geology and moisture',
    params: {
      assets: ['B12', 'B08', 'B04'],
      rescale: '0,3000',
    },
  },
];

/**
 * Render presets for Landsat Collection 2 Level-2.
 */
const landsatC2L2Presets: RenderPreset[] = [
  {
    name: 'true-color',
    label: 'True Color',
    description: 'Natural color composite (RGB)',
    params: {
      assets: ['red', 'green', 'blue'],
      rescale: '0,20000',
    },
  },
  {
    name: 'false-color',
    label: 'False Color (Vegetation)',
    description: 'NIR-Red-Green composite',
    params: {
      assets: ['nir08', 'red', 'green'],
      rescale: '0,20000',
    },
  },
  {
    name: 'ndvi',
    label: 'NDVI',
    description: 'Normalized Difference Vegetation Index',
    params: {
      expression: '(nir08-red)/(nir08+red)',
      rescale: '-1,1',
      colormap_name: 'rdylgn',
    },
  },
  {
    name: 'thermal',
    label: 'Thermal',
    description: 'Land surface temperature',
    params: {
      assets: ['lwir11'],
      rescale: '290,320',
      colormap_name: 'magma',
    },
  },
];

/**
 * Render presets for NAIP imagery.
 */
const naipPresets: RenderPreset[] = [
  {
    name: 'rgb',
    label: 'RGB',
    description: 'Natural color',
    params: {
      assets: ['image'],
      asset_bidx: { image: '1,2,3' },
    },
  },
  {
    name: 'cir',
    label: 'Color Infrared',
    description: 'NIR-Red-Green composite',
    params: {
      assets: ['image'],
      asset_bidx: { image: '4,1,2' },
    },
  },
  {
    name: 'ndvi',
    label: 'NDVI',
    description: 'Vegetation index from NAIP',
    params: {
      expression: '(image_b4-image_b1)/(image_b4+image_b1)',
      rescale: '-1,1',
      colormap_name: 'rdylgn',
    },
  },
];

/**
 * Render presets for Copernicus DEM.
 */
const demPresets: RenderPreset[] = [
  {
    name: 'elevation',
    label: 'Elevation',
    description: 'Color-coded elevation',
    params: {
      assets: ['data'],
      colormap_name: 'terrain',
      rescale: '0,4000',
    },
  },
  {
    name: 'hillshade',
    label: 'Hillshade',
    description: 'Shaded relief visualization',
    params: {
      assets: ['data'],
      colormap_name: 'gray',
      rescale: '0,255',
    },
  },
];

/**
 * Default render configurations for common collections.
 */
export const RENDER_CONFIGS: CollectionRenderConfig[] = [
  {
    collectionId: 'sentinel-2-l2a',
    defaultPreset: 'true-color',
    presets: sentinel2L2aPresets,
  },
  {
    collectionId: 'landsat-c2-l2',
    defaultPreset: 'true-color',
    presets: landsatC2L2Presets,
  },
  {
    collectionId: 'naip',
    defaultPreset: 'rgb',
    presets: naipPresets,
  },
  {
    collectionId: 'cop-dem-glo-30',
    defaultPreset: 'elevation',
    presets: demPresets,
  },
  {
    collectionId: 'cop-dem-glo-90',
    defaultPreset: 'elevation',
    presets: demPresets,
  },
];

/**
 * Gets render configuration for a collection.
 *
 * @param collectionId - Collection identifier.
 * @returns Render configuration or undefined if not found.
 */
export function getRenderConfig(collectionId: string): CollectionRenderConfig | undefined {
  return RENDER_CONFIGS.find((config) => config.collectionId === collectionId);
}

/**
 * Gets available presets for a collection.
 *
 * @param collectionId - Collection identifier.
 * @returns Array of render presets.
 */
export function getPresetsForCollection(collectionId: string): RenderPreset[] {
  const config = getRenderConfig(collectionId);
  return config?.presets ?? [];
}

/**
 * Gets the default preset for a collection.
 *
 * @param collectionId - Collection identifier.
 * @returns Default render preset or undefined.
 */
export function getDefaultPreset(collectionId: string): RenderPreset | undefined {
  const config = getRenderConfig(collectionId);
  if (!config) return undefined;
  return config.presets.find((p) => p.name === config.defaultPreset);
}

/**
 * Gets a specific preset by name for a collection.
 *
 * @param collectionId - Collection identifier.
 * @param presetName - Preset name.
 * @returns Render preset or undefined.
 */
export function getPreset(collectionId: string, presetName: string): RenderPreset | undefined {
  const config = getRenderConfig(collectionId);
  return config?.presets.find((p) => p.name === presetName);
}
