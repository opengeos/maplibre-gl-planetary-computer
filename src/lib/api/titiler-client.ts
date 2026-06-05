import type {
  PointValueResponse,
  StatisticsParams,
  TileJSONMetadata,
  TileParams,
  STACSearchParams,
} from './types';

const DEFAULT_TILER_URL = 'https://planetarycomputer.microsoft.com/api/data/v1';

/**
 * Client for interacting with the Planetary Computer TiTiler API.
 * Provides methods for generating tile URLs for visualization.
 */
export class TiTilerClient {
  private baseUrl: string;

  /**
   * Creates a new TiTiler API client.
   *
   * @param baseUrl - Base URL for the TiTiler API.
   */
  constructor(baseUrl: string = DEFAULT_TILER_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Generates a tile URL template for a single STAC item.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param params - Tile rendering parameters.
   * @returns Tile URL template with {z}/{x}/{y} placeholders.
   */
  getItemTileUrl(collectionId: string, itemId: string, params: TileParams = {}): string {
    const queryString = this.buildQueryString(params);
    const query = queryString ? `?${queryString}` : '';
    const scale = params.tile_scale || 1;
    const format = params.tile_format ? `.${params.tile_format}` : '';
    return `${this.baseUrl}/item/tiles/WebMercatorQuad/{z}/{x}/{y}@${scale}x${format}?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${query ? '&' + queryString : ''}`;
  }

  /**
   * Generates a tile URL for a collection mosaic.
   *
   * @param collectionId - Collection identifier.
   * @param params - Tile rendering parameters.
   * @param searchParams - Optional STAC search parameters for filtering the mosaic.
   * @returns Tile URL template with {z}/{x}/{y} placeholders.
   */
  getCollectionTileUrl(
    collectionId: string,
    params: TileParams = {},
    searchParams?: Partial<STACSearchParams>
  ): string {
    const tileParams = this.buildQueryString(params);
    const searchStr = searchParams ? this.buildSearchParams(searchParams) : '';

    const allParams = [
      `collection=${encodeURIComponent(collectionId)}`,
      tileParams,
      searchStr,
    ]
      .filter(Boolean)
      .join('&');

    const scale = params.tile_scale || 1;
    const format = params.tile_format ? `.${params.tile_format}` : '';
    return `${this.baseUrl}/mosaic/tiles/WebMercatorQuad/{z}/{x}/{y}@${scale}x${format}?${allParams}`;
  }

  /**
   * Fetches TileJSON metadata for a STAC item.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param params - Tile rendering parameters.
   * @returns Promise resolving to TileJSON metadata.
   */
  async getItemTileJSON(
    collectionId: string,
    itemId: string,
    params: TileParams = {}
  ): Promise<TileJSONMetadata> {
    const queryString = this.buildQueryString(params);
    const response = await fetch(
      `${this.baseUrl}/item/WebMercatorQuad/tilejson.json?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${queryString ? '&' + queryString : ''}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get item TileJSON: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Gets the TileJSON URL for a STAC item.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param params - Tile rendering parameters.
   * @returns TileJSON URL.
   */
  getItemTileJSONUrl(collectionId: string, itemId: string, params: TileParams = {}): string {
    const queryString = this.buildQueryString(params);
    return `${this.baseUrl}/item/WebMercatorQuad/tilejson.json?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${queryString ? '&' + queryString : ''}`;
  }

  /**
   * Fetches TileJSON metadata for a collection mosaic.
   *
   * @param collectionId - Collection identifier.
   * @param params - Tile rendering parameters.
   * @param searchParams - Optional STAC search parameters for filtering the mosaic.
   * @returns Promise resolving to TileJSON metadata.
   */
  async getCollectionTileJSON(
    collectionId: string,
    params: TileParams = {},
    searchParams?: Partial<STACSearchParams>
  ): Promise<TileJSONMetadata> {
    const tileParams = this.buildQueryString(params);
    const searchStr = searchParams ? this.buildSearchParams(searchParams) : '';
    const query = [
      `collection=${encodeURIComponent(collectionId)}`,
      tileParams,
      searchStr,
    ]
      .filter(Boolean)
      .join('&');
    const response = await fetch(`${this.baseUrl}/mosaic/WebMercatorQuad/tilejson.json?${query}`);

    if (!response.ok) {
      throw new Error(`Failed to get collection TileJSON: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Registers a custom search mosaic and returns the tile URL.
   *
   * @param searchParams - STAC search parameters for the mosaic.
   * @param tileParams - Tile rendering parameters.
   * @returns Promise resolving to mosaic info including tile URL and search ID.
   */
  async registerMosaic(
    searchParams: STACSearchParams,
    tileParams: TileParams = {}
  ): Promise<{ searchId: string; tileUrl: string }> {
    const response = await fetch(`${this.baseUrl}/mosaic/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: searchParams.collections,
        filter: searchParams.filter,
        'filter-lang': searchParams['filter-lang'] || 'cql2-json',
        sortby: searchParams.sortby,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register mosaic: ${response.statusText}`);
    }

    const data = await response.json();
    const searchId = data.id || data.searchid;
    const queryString = this.buildQueryString(tileParams);

    return {
      searchId,
      tileUrl: `${this.baseUrl}/mosaic/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?searchid=${searchId}${queryString ? '&' + queryString : ''}`,
    };
  }

  /**
   * Fetches metadata for a STAC item (bounds, statistics, etc.).
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param assets - Asset names to include.
   * @returns Promise resolving to item info.
   */
  async getItemInfo(
    collectionId: string,
    itemId: string,
    assets?: string[]
  ): Promise<Record<string, unknown>> {
    const assetParam = assets?.length ? `&assets=${assets.join(',')}` : '';
    const response = await fetch(
      `${this.baseUrl}/item/info?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${assetParam}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get item info: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetches available statistics for an item.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param assets - Asset names.
   * @returns Promise resolving to statistics.
   */
  async getItemStatistics(
    collectionId: string,
    itemId: string,
    params: StatisticsParams = {}
  ): Promise<Record<string, unknown>> {
    const queryString = this.buildQueryString(params);
    const query = queryString ? `&${queryString}` : '';
    const response = await fetch(
      `${this.baseUrl}/item/statistics?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${query}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get item statistics: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Gets pixel values for a STAC item at a coordinate.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param lon - Longitude.
   * @param lat - Latitude.
   * @param params - Rendering parameters.
   * @returns Promise resolving to point values.
   */
  async getItemPoint(
    collectionId: string,
    itemId: string,
    lon: number,
    lat: number,
    params: TileParams = {}
  ): Promise<PointValueResponse> {
    const queryString = this.buildQueryString(params);
    const query = queryString ? `&${queryString}` : '';
    const response = await fetch(
      `${this.baseUrl}/item/point/${lon},${lat}?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${query}`
    );

    if (!response.ok) {
      throw new Error(await this.getErrorMessage(response, 'Failed to get point values'));
    }

    return response.json();
  }

  /**
   * Builds an informative error message from an API response.
   */
  private async getErrorMessage(response: Response, fallback: string): Promise<string> {
    let detail = '';

    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await response.json();
        const rawDetail = body.detail || body.message || body.error;
        detail = Array.isArray(rawDetail) ? rawDetail.map((entry) => entry.msg || String(entry)).join('; ') : String(rawDetail || '');
      } else {
        detail = await response.text();
      }
    } catch {
      detail = '';
    }

    const status = response.statusText || `HTTP ${response.status}`;
    return [fallback, detail || status].filter(Boolean).join(': ');
  }

  /**
   * Gets a rendered preview URL for a STAC item.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param params - Rendering parameters.
   * @param format - Output image format.
   * @returns Preview image URL.
   */
  getItemPreviewUrl(
    collectionId: string,
    itemId: string,
    params: TileParams = {},
    format: 'png' | 'jpg' | 'jpeg' | 'webp' = 'png'
  ): string {
    const queryString = this.buildQueryString(params);
    return `${this.baseUrl}/item/preview.${format}?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${queryString ? '&' + queryString : ''}`;
  }

  /**
   * Gets a rendered bbox image URL for a STAC item.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param bbox - Bounding box [west, south, east, north].
   * @param size - Output image size.
   * @param params - Rendering parameters.
   * @param format - Output image format.
   * @returns Bbox image URL.
   */
  getItemBboxImageUrl(
    collectionId: string,
    itemId: string,
    bbox: [number, number, number, number],
    size: { width: number; height: number } = { width: 768, height: 512 },
    params: TileParams = {},
    format: 'png' | 'jpg' | 'jpeg' | 'webp' = 'png'
  ): string {
    const queryString = this.buildQueryString(params);
    return `${this.baseUrl}/item/bbox/${bbox.join(',')}/${size.width}x${size.height}.${format}?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${queryString ? '&' + queryString : ''}`;
  }

  /**
   * Gets a legend image URL for a named colormap.
   *
   * @param colormapName - Named colormap.
   * @param size - Legend image size.
   * @returns Legend image URL.
   */
  getColormapLegendUrl(
    colormapName: string,
    size: { width: number; height: number } = { width: 220, height: 30 }
  ): string {
    return `${this.baseUrl}/legend/colormap/${encodeURIComponent(colormapName)}?width=${size.width}&height=${size.height}`;
  }

  /**
   * Gets the base URL of the TiTiler API.
   *
   * @returns The base URL.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Builds query string from tile parameters.
   *
   * @param params - Tile parameters.
   * @returns URL query string.
   */
  private buildQueryString(params: TileParams): string {
    const searchParams = new URLSearchParams();

    if (params.assets?.length) {
      params.assets.forEach((asset) => searchParams.append('assets', asset));
    }
    if (params.bidx?.length) {
      params.bidx.forEach((bidx) => searchParams.append('bidx', String(bidx)));
    }
    if (params.expression) {
      searchParams.set('expression', params.expression);
    }
    if (params.rescale) {
      searchParams.set('rescale', params.rescale);
    }
    if (params.colormap_name) {
      searchParams.set('colormap_name', params.colormap_name);
    }
    if (params.colormap) {
      searchParams.set('colormap', JSON.stringify(params.colormap));
    }
    if (params.nodata !== undefined) {
      searchParams.set('nodata', String(params.nodata));
    }
    if (params.resampling) {
      searchParams.set('resampling', params.resampling);
    }
    if (params.return_mask !== undefined) {
      searchParams.set('return_mask', String(params.return_mask));
    }
    if (params.unscale !== undefined) {
      searchParams.set('unscale', String(params.unscale));
    }
    if (params.color_formula) {
      searchParams.set('color_formula', params.color_formula);
    }
    if (params.asset_as_band !== undefined) {
      searchParams.set('asset_as_band', String(params.asset_as_band));
    }
    if (params.algorithm) {
      searchParams.set('algorithm', params.algorithm);
    }
    if (params.algorithm_params) {
      searchParams.set('algorithm_params', params.algorithm_params);
    }
    if (params.buffer !== undefined) {
      searchParams.set('buffer', String(params.buffer));
    }
    if (params.tile_format) {
      searchParams.set('tile_format', params.tile_format);
    }
    if (params.tile_scale) {
      searchParams.set('tile_scale', String(params.tile_scale));
    }
    if (params.minzoom !== undefined) {
      searchParams.set('minzoom', String(params.minzoom));
    }
    if (params.maxzoom !== undefined) {
      searchParams.set('maxzoom', String(params.maxzoom));
    }
    if (params.tile_size) {
      searchParams.set('tile_size', String(params.tile_size));
    }
    if (params.asset_bidx) {
      Object.entries(params.asset_bidx).forEach(([asset, bidx]) => {
        searchParams.append('asset_bidx', `${asset}|${bidx}`);
      });
    }
    const statisticsParams = params as StatisticsParams;
    if (statisticsParams.max_size !== undefined) {
      searchParams.set('max_size', String(statisticsParams.max_size));
    }
    if (statisticsParams.height !== undefined) {
      searchParams.set('height', String(statisticsParams.height));
    }
    if (statisticsParams.width !== undefined) {
      searchParams.set('width', String(statisticsParams.width));
    }
    if (statisticsParams.categorical !== undefined) {
      searchParams.set('categorical', String(statisticsParams.categorical));
    }
    if (statisticsParams.c?.length) {
      statisticsParams.c.forEach((value) => searchParams.append('c', String(value)));
    }
    if (statisticsParams.p?.length) {
      statisticsParams.p.forEach((value) => searchParams.append('p', String(value)));
    }
    if (statisticsParams.histogram_bins !== undefined) {
      searchParams.set('histogram_bins', String(statisticsParams.histogram_bins));
    }
    if (statisticsParams.histogram_range) {
      searchParams.set('histogram_range', statisticsParams.histogram_range.join(','));
    }

    return searchParams.toString();
  }

  /**
   * Builds search parameters for mosaic requests.
   *
   * @param params - STAC search parameters.
   * @returns URL query string.
   */
  private buildSearchParams(params: Partial<STACSearchParams>): string {
    const parts: string[] = [];

    if (params.datetime) {
      parts.push(`datetime=${encodeURIComponent(params.datetime)}`);
    }
    if (params.bbox) {
      parts.push(`bbox=${params.bbox.join(',')}`);
    }

    return parts.join('&');
  }
}
