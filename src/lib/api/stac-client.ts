import type {
  STACCollection,
  STACCollectionsResponse,
  STACItem,
  STACItemCollection,
  STACSearchParams,
} from './types';

const DEFAULT_STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';

/**
 * Client for interacting with the Planetary Computer STAC API.
 * Provides methods for browsing collections, searching items, and fetching metadata.
 */
export class STACClient {
  private baseUrl: string;
  private abortController: AbortController | null = null;

  /**
   * Creates a new STAC API client.
   *
   * @param baseUrl - Base URL for the STAC API.
   */
  constructor(baseUrl: string = DEFAULT_STAC_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Fetches all available collections.
   *
   * @returns Promise resolving to array of collections.
   */
  async getCollections(): Promise<STACCollection[]> {
    const response = await this.fetch<STACCollectionsResponse>('/collections');
    return response.collections;
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
    // Cancel any pending search
    this.abortController?.abort();
    this.abortController = new AbortController();

    const response = await this.fetch<STACItemCollection>('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: this.abortController.signal,
    });

    return response.features;
  }

  /**
   * Searches for items and returns the full response with context.
   *
   * @param params - Search parameters.
   * @returns Promise resolving to the full item collection response.
   */
  async searchWithContext(params: STACSearchParams): Promise<STACItemCollection> {
    this.abortController?.abort();
    this.abortController = new AbortController();

    return this.fetch<STACItemCollection>('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: this.abortController.signal,
    });
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

    try {
      const response = await fetch(url, options);

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
