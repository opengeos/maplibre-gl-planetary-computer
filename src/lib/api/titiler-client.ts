import type { TileParams, STACSearchParams } from './types';

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
    return `${this.baseUrl}/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${query ? '&' + queryString : ''}`;
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

    return `${this.baseUrl}/mosaic/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${allParams}`;
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
    assets?: string[]
  ): Promise<Record<string, unknown>> {
    const assetParam = assets?.length ? `&assets=${assets.join(',')}` : '';
    const response = await fetch(
      `${this.baseUrl}/item/statistics?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${assetParam}`
    );

    if (!response.ok) {
      throw new Error(`Failed to get item statistics: ${response.statusText}`);
    }

    return response.json();
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
    if (params.tile_size) {
      searchParams.set('tile_size', String(params.tile_size));
    }
    if (params.asset_bidx) {
      Object.entries(params.asset_bidx).forEach(([asset, bidx]) => {
        searchParams.append('asset_bidx', `${asset}|${bidx}`);
      });
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
