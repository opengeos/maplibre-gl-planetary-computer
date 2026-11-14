import type {
  PointValueResponse,
  StatisticsParams,
  TileJSONMetadata,
  TileParams,
  STACSearchParams,
} from './types';

const DEFAULT_TILER_URL = 'https://planetarycomputer.microsoft.com/api/data/v1';

const QUERY_OPERATORS: Record<string, string> = {
  eq: '=',
  neq: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

/**
 * Splits a STAC `datetime` value into a closed CQL2 interval.
 *
 * @param datetime - Single datetime or `start/end` range (`..` for open ends).
 * @returns The `[start, end]` interval.
 */
function datetimeInterval(datetime: string): [string, string] {
  const [start, end] = datetime.includes('/') ? datetime.split('/') : [datetime, datetime];
  return [start && start !== '..' ? start : '..', end && end !== '..' ? end : '..'];
}

/**
 * Builds the body for a Data API `POST /mosaic/register` request.
 *
 * The mosaic endpoint takes a CQL2 search, so the simple STAC search fields
 * (`datetime`, the `query` extension, `bbox`) are translated into one CQL2
 * JSON `filter`. An explicit `filter` in the parameters is combined with them.
 *
 * @param searchParams - STAC search parameters describing the mosaic.
 * @returns The JSON-serializable request body.
 */
export function buildMosaicSearchBody(searchParams: Partial<STACSearchParams>): Record<string, unknown> {
  const args: unknown[] = [];

  for (const collection of searchParams.collections ?? []) {
    args.push({ op: '=', args: [{ property: 'collection' }, collection] });
  }
  if (searchParams.datetime) {
    args.push({
      op: 'anyinteracts',
      args: [{ property: 'datetime' }, { interval: datetimeInterval(searchParams.datetime) }],
    });
  }
  if (searchParams.bbox) {
    const [west, south, east, north] = searchParams.bbox;
    args.push({
      op: 's_intersects',
      args: [
        { property: 'geometry' },
        {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      ],
    });
  }
  for (const [property, conditions] of Object.entries(searchParams.query ?? {})) {
    if (!conditions || typeof conditions !== 'object') continue;
    for (const [operator, value] of Object.entries(conditions as Record<string, unknown>)) {
      const op = QUERY_OPERATORS[operator];
      if (op) args.push({ op, args: [{ property }, value] });
    }
  }
  if (searchParams.filter) args.push(searchParams.filter);

  const body: Record<string, unknown> = { 'filter-lang': 'cql2-json' };
  if (searchParams.collections?.length) body.collections = searchParams.collections;
  if (args.length === 1) body.filter = args[0];
  else if (args.length > 1) body.filter = { op: 'and', args };
  if (searchParams.sortby?.length) body.sortby = searchParams.sortby;
  return body;
}

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
    const scale = params.tile_scale || 1;
    const format = params.tile_format ? `.${params.tile_format}` : '';
    return `${this.baseUrl}/item/tiles/WebMercatorQuad/{z}/{x}/{y}@${scale}x${format}?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${queryString ? '&' + queryString : ''}`;
  }

  /**
   * Generates a tile URL for a collection mosaic.
   *
   * @deprecated The Planetary Computer Data API only serves mosaic tiles for a
   * registered search. Use {@link TiTilerClient.registerMosaic} and
   * {@link TiTilerClient.getMosaicTileUrl} instead.
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
   * Registers a search as a mosaic and returns its tile URL.
   *
   * The search is the set of items the mosaic draws from (collections, date
   * range, cloud cover, ...). Registration is idempotent, and search ids are
   * not guaranteed to live forever, so re-register when restoring a saved layer.
   *
   * @param searchParams - STAC search parameters for the mosaic.
   * @param tileParams - Tile rendering parameters.
   * @returns Promise resolving to mosaic info including tile URL and search ID.
   */
  async registerMosaic(
    searchParams: Partial<STACSearchParams>,
    tileParams: TileParams = {}
  ): Promise<{ searchId: string; tileUrl: string }> {
    const response = await fetch(`${this.baseUrl}/mosaic/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMosaicSearchBody(searchParams)),
    });

    if (!response.ok) {
      throw new Error(await this.getErrorMessage(response, 'Failed to register mosaic'));
    }

    const data = await response.json();
    const searchId = data.searchid || data.id;
    if (!searchId) throw new Error('Failed to register mosaic: no search id returned');

    return {
      searchId,
      tileUrl: this.getMosaicTileUrl(searchId, tileParams, searchParams.collections?.[0]),
    };
  }

  /**
   * Generates a tile URL template for a registered mosaic.
   *
   * @param searchId - Search id returned by {@link TiTilerClient.registerMosaic}.
   * @param params - Tile rendering parameters.
   * @param collectionId - Collection the mosaic draws from (lets the API apply collection defaults).
   * @returns Tile URL template with {z}/{x}/{y} placeholders.
   */
  getMosaicTileUrl(searchId: string, params: TileParams = {}, collectionId?: string): string {
    const query = [
      collectionId ? `collection=${encodeURIComponent(collectionId)}` : '',
      this.buildQueryString(params),
    ]
      .filter(Boolean)
      .join('&');
    const scale = params.tile_scale || 1;
    const format = params.tile_format ? `.${params.tile_format}` : '';
    return `${this.baseUrl}/mosaic/${encodeURIComponent(searchId)}/tiles/WebMercatorQuad/{z}/{x}/{y}@${scale}x${format}${query ? '?' + query : ''}`;
  }

  /**
   * Lists the items a registered mosaic draws from at a coordinate, topmost first.
   *
   * @param searchId - Search id returned by {@link TiTilerClient.registerMosaic}.
   * @param lon - Longitude.
   * @param lat - Latitude.
   * @param collectionId - Collection the mosaic draws from.
   * @returns Promise resolving to the contributing items (id, bbox, assets, collection).
   */
  async getMosaicItemsAtPoint(
    searchId: string,
    lon: number,
    lat: number,
    collectionId?: string
  ): Promise<Array<{ id: string; collection?: string; bbox?: number[]; [key: string]: unknown }>> {
    const query = collectionId ? `?collection=${encodeURIComponent(collectionId)}` : '';
    const response = await fetch(
      `${this.baseUrl}/mosaic/${encodeURIComponent(searchId)}/${lon},${lat}/assets${query}`
    );

    if (!response.ok) {
      throw new Error(await this.getErrorMessage(response, 'Failed to get mosaic items'));
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
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
   * Gets a URL that clips a STAC item to a bounding box at (up to) native resolution.
   *
   * Unlike {@link TiTilerClient.getItemBboxImageUrl} the output size follows
   * the data, capped by `maxSize`. With the default `tif` format and no
   * `rescale`/`colormap_name` the result is a GeoTIFF holding the raw band
   * values, suitable for analysis.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @param bbox - Bounding box [west, south, east, north] in WGS84.
   * @param params - Rendering parameters (assets, expression, ...).
   * @param options - Output format and maximum dimension in pixels.
   * @returns Clip URL.
   */
  getItemCropUrl(
    collectionId: string,
    itemId: string,
    bbox: [number, number, number, number],
    params: TileParams = {},
    options: { format?: 'tif' | 'png' | 'jpg' | 'jpeg' | 'webp' | 'npy'; maxSize?: number } = {}
  ): string {
    const format = options.format ?? 'tif';
    const queryString = this.buildQueryString({
      ...params,
      max_size: options.maxSize ?? 2048,
    } as StatisticsParams);
    return `${this.baseUrl}/item/bbox/${bbox.join(',')}.${format}?collection=${encodeURIComponent(collectionId)}&item=${encodeURIComponent(itemId)}${queryString ? '&' + queryString : ''}`;
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
