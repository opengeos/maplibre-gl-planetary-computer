import type { Geometry } from 'geojson';

/**
 * STAC Link object.
 */
export interface STACLink {
  href: string;
  rel: string;
  type?: string;
  title?: string;
}

/**
 * STAC Provider information.
 */
export interface STACProvider {
  name: string;
  description?: string;
  roles?: string[];
  url?: string;
}

/**
 * STAC Asset representing a file or resource.
 */
export interface STACAsset {
  href: string;
  title?: string;
  description?: string;
  type?: string;
  roles?: string[];
  'raster:bands'?: Array<{
    name?: string;
    common_name?: string;
    description?: string;
    nodata?: number;
    data_type?: string;
  }>;
  [key: string]: unknown;
}

/**
 * STAC Collection metadata.
 */
export interface STACCollection {
  id: string;
  type: 'Collection';
  stac_version: string;
  stac_extensions?: string[];
  title?: string;
  description?: string;
  keywords?: string[];
  license?: string;
  providers?: STACProvider[];
  extent: {
    spatial: { bbox: number[][] };
    temporal: { interval: (string | null)[][] };
  };
  summaries?: Record<string, unknown>;
  links: STACLink[];
  assets?: Record<string, STACAsset>;
  item_assets?: Record<string, STACAsset>;
  'msft:short_description'?: string;
  'msft:storage_account'?: string;
  'msft:container'?: string;
  'msft:region'?: string;
}

/**
 * STAC Collections response.
 */
export interface STACCollectionsResponse {
  collections: STACCollection[];
  links: STACLink[];
}

/**
 * STAC Item representing a single data asset.
 */
export interface STACItem {
  id: string;
  type: 'Feature';
  stac_version: string;
  stac_extensions?: string[];
  geometry: Geometry;
  bbox: number[];
  properties: {
    datetime: string | null;
    start_datetime?: string;
    end_datetime?: string;
    created?: string;
    updated?: string;
    'eo:cloud_cover'?: number;
    'proj:epsg'?: number;
    [key: string]: unknown;
  };
  links: STACLink[];
  assets: Record<string, STACAsset>;
  collection?: string;
}

/**
 * STAC Item Collection (search results).
 */
export interface STACItemCollection {
  type: 'FeatureCollection';
  features: STACItem[];
  links?: STACLink[];
  context?: {
    returned: number;
    limit: number;
    matched?: number;
  };
}

/**
 * Search parameters for STAC API.
 */
export interface STACSearchParams {
  /** Collection IDs to search within */
  collections?: string[];
  /** Bounding box [west, south, east, north] */
  bbox?: [number, number, number, number];
  /** Datetime filter (single datetime or range) */
  datetime?: string;
  /** GeoJSON geometry to intersect */
  intersects?: Geometry;
  /** Specific item IDs to fetch */
  ids?: string[];
  /** Maximum number of items to return */
  limit?: number;
  /** CQL2 query filter */
  query?: Record<string, unknown>;
  /** Sort order */
  sortby?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  /** Filter expression */
  filter?: Record<string, unknown>;
  /** Filter language */
  'filter-lang'?: 'cql2-json' | 'cql2-text';
}

/**
 * TiTiler tile rendering parameters.
 */
export interface TileParams {
  /** Asset names to use */
  assets?: string[];
  /** Band indexes */
  bidx?: number[];
  /** Band math expression */
  expression?: string;
  /** Rescale values (e.g., "0,255" or "0,10000") */
  rescale?: string;
  /** Named colormap */
  colormap_name?: string;
  /** Custom colormap */
  colormap?: Record<number, number[]>;
  /** No data value */
  nodata?: number;
  /** Resampling method */
  resampling?: 'nearest' | 'bilinear' | 'cubic' | 'lanczos';
  /** Return mask */
  return_mask?: boolean;
  /** Apply internal scale and offset */
  unscale?: boolean;
  /** Rio color formula */
  color_formula?: string;
  /** Asset as band */
  asset_as_band?: boolean;
  /** Processing algorithm */
  algorithm?: string;
  /** Processing algorithm parameters */
  algorithm_params?: string;
  /** Tile buffer */
  buffer?: number;
  /** Tile output format */
  tile_format?: 'png' | 'jpg' | 'jpeg' | 'webp' | 'pngraw';
  /** Tile resolution scale */
  tile_scale?: 1 | 2 | 3 | 4;
  /** Minimum zoom */
  minzoom?: number;
  /** Maximum zoom */
  maxzoom?: number;
  /** Tile size */
  tile_size?: number;
  /** Asset band indexes */
  asset_bidx?: Record<string, string>;
}

/**
 * TileJSON metadata returned by the Data API.
 */
export interface TileJSONMetadata {
  tilejson?: string;
  name?: string;
  version?: string;
  scheme?: string;
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
  center?: [number, number, number];
  attribution?: string;
  [key: string]: unknown;
}

/**
 * Statistics request options.
 */
export interface StatisticsParams extends TileParams {
  /** Maximum raster size sampled for statistics */
  max_size?: number;
  /** Output height */
  height?: number;
  /** Output width */
  width?: number;
  /** Treat values as categorical */
  categorical?: boolean;
  /** Category values */
  c?: number[];
  /** Percentiles */
  p?: number[];
  /** Histogram bin count */
  histogram_bins?: number;
  /** Histogram range */
  histogram_range?: [number, number];
}

/**
 * Band statistics returned by the Data API.
 */
export interface BandStatistics {
  min: number;
  max: number;
  mean: number;
  count: number;
  sum: number;
  std: number;
  median: number;
  majority: number;
  minority: number;
  unique: number;
  histogram: [number[], number[]];
  valid_percent: number;
  masked_pixels: number;
  valid_pixels: number;
  [key: string]: unknown;
}

/**
 * Point query response returned by the Data API.
 */
export interface PointValueResponse {
  coordinates?: [number, number];
  values?: unknown[];
  band_names?: string[];
  [key: string]: unknown;
}

/**
 * Render preset for a collection.
 */
export interface RenderPreset {
  /** Preset name */
  name: string;
  /** Display label */
  label: string;
  /** Description */
  description?: string;
  /** Tile parameters */
  params: TileParams;
}

/**
 * Collection render configuration.
 */
export interface CollectionRenderConfig {
  /** Collection ID */
  collectionId: string;
  /** Default render preset */
  defaultPreset: string;
  /** Available presets */
  presets: RenderPreset[];
}

/**
 * SAS Token response from Planetary Computer.
 */
export interface SASTokenResponse {
  token: string;
  'msft:expiry': string;
}
