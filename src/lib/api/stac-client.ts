import type {
  STACCollection,
  STACCollectionsResponse,
  STACItem,
  STACItemCollection,
  STACSearchParams,
} from './types';

const DEFAULT_STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';

/**
 * Options for {@link STACClient}.
 */
export interface STACClientOptions {
  /**
   * HTTP method used for item search.
   *
   * `GET` is the default because it is a "simple" cross-origin request: it
   * needs no CORS preflight, so it keeps working from a browser origin (and
   * from desktop webviews) even when the API rejects the `OPTIONS` preflight a
   * JSON `POST /search` requires. Use `POST` for very large `intersects`
   * geometries that do not fit in a URL.
   * @default 'GET'
   */
  searchMethod?: 'GET' | 'POST';

  /**
   * Custom fetch implementation (for proxies, auth headers, or tests).
   * @default globalThis.fetch
   */
  fetch?: typeof fetch;

  /**
   * Supplies the collection list when the live `/collections` request fails,
   * for example a bundled snapshot. When omitted the failure is rethrown.
   */
  fallbackCollections?: () => Promise<STACCollection[]> | STACCollection[];

  /**
   * Called with the error that made the client use `fallbackCollections`.
   */
  onCollectionsFallback?: (error: unknown) => void;
}

/**
 * Builds the query string for a STAC API `GET /search` request.
 *
 * Follows the STAC API item-search GET encoding: comma-joined
 * `collections`/`ids`/`bbox`, JSON-encoded `intersects`/`query`/`filter`, and
 * `sortby` as `+field`/`-field`.
 *
 * @param params - Search parameters.
 * @returns The URL-encoded query string, without a leading `?`.
 */
export function buildStacSearchQuery(params: STACSearchParams): string {
  const query = new URLSearchParams();
  if (params.collections?.length) query.set('collections', params.collections.join(','));
  if (params.ids?.length) query.set('ids', params.ids.join(','));
  if (params.bbox?.length) query.set('bbox', params.bbox.join(','));
  if (params.intersects) query.set('intersects', JSON.stringify(params.intersects));
  if (params.datetime) query.set('datetime', params.datetime);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.query && Object.keys(params.query).length > 0) {
    query.set('query', JSON.stringify(params.query));
  }
  if (params.sortby?.length) {
    query.set(
      'sortby',
      params.sortby
        .map(({ field, direction }) => `${direction === 'desc' ? '-' : '+'}${field}`)
        .join(',')
    );
  }
  if (params.filter) {
    query.set('filter', JSON.stringify(params.filter));
    query.set('filter-lang', params['filter-lang'] ?? 'cql2-json');
  }
  return query.toString();
}

/**
 * Client for interacting with the Planetary Computer STAC API.
 * Provides methods for browsing collections, searching items, and fetching metadata.
 */
export class STACClient {
  private baseUrl: string;
  private abortController: AbortController | null = null;
  private options: STACClientOptions;

  /**
   * Creates a new STAC API client.
   *
   * @param baseUrl - Base URL for the STAC API.
   * @param options - Client options (search method, custom fetch, collection fallback).
   */
  constructor(baseUrl: string = DEFAULT_STAC_URL, options: STACClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.options = options;
  }

  /**
   * Fetches all available collections.
   *
   * Falls back to `options.fallbackCollections` when the live request fails.
   *
   * @returns Promise resolving to array of collections.
   */
  async getCollections(): Promise<STACCollection[]> {
    try {
      const response = await this.fetch<STACCollectionsResponse>('/collections');
      return response.collections;
    } catch (error) {
      if (!this.options.fallbackCollections) throw error;
      this.options.onCollectionsFallback?.(error);
      return this.options.fallbackCollections();
    }
  }

  /**
   * Fetches a single collection by ID.
   *
   * @param collectionId - Collection identifier.
   * @returns Promise resolving to collection metadata.
   */
  async getCollection(collectionId: string): Promise<STACCollection> {
    return this.fetch<STACCollection>(`/collections/${encodeURIComponent(collectionId)}`);
  }

  /**
   * Searches for items matching the given parameters.
   *
   * @param params - Search parameters (bbox, datetime, collections, etc.).
   * @returns Promise resolving to array of matching items.
   */
  async search(params: STACSearchParams): Promise<STACItem[]> {
    return (await this.searchWithContext(params)).features;
  }

  /**
   * Searches for items and returns the full response with context.
   *
   * Starting a search cancels the previous one that is still pending.
   *
   * @param params - Search parameters.
   * @returns Promise resolving to the full item collection response.
   */
  async searchWithContext(params: STACSearchParams): Promise<STACItemCollection> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    if (this.options.searchMethod === 'POST') {
      return this.fetch<STACItemCollection>('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      });
    }

    return this.fetch<STACItemCollection>(`/search?${buildStacSearchQuery(params)}`, { signal });
  }

  /**
   * Fetches items from a specific collection.
   *
   * @param collectionId - Collection identifier.
   * @param limit - Maximum number of items to return.
   * @returns Promise resolving to array of items.
   */
  async getCollectionItems(collectionId: string, limit: number = 50): Promise<STACItem[]> {
    const response = await this.fetch<STACItemCollection>(
      `/collections/${encodeURIComponent(collectionId)}/items?limit=${limit}`
    );
    return response.features;
  }

  /**
   * Fetches a single item by collection and item ID.
   *
   * @param collectionId - Collection identifier.
   * @param itemId - Item identifier.
   * @returns Promise resolving to item metadata.
   */
  async getItem(collectionId: string, itemId: string): Promise<STACItem> {
    return this.fetch<STACItem>(
      `/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`
    );
  }

  /**
   * Cancels any pending requests.
   */
  cancelPending(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Gets the base URL of the STAC API.
   *
   * @returns The base URL.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Internal fetch wrapper with error handling.
   *
   * @param path - API path.
   * @param options - Fetch options.
   * @returns Promise resolving to parsed JSON response.
   */
  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const fetchImpl = this.options.fetch ?? fetch;

    try {
      const response = await fetchImpl(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`STAC API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request was cancelled');
      }
      throw error;
    }
  }
}
