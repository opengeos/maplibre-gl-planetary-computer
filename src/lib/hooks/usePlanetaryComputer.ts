import { useState, useCallback, useRef, useEffect } from 'react';
import { STACClient } from '../api/stac-client';
import { TiTilerClient } from '../api/titiler-client';
import { SASTokenManager } from '../api/sas-token';
import type {
  STACCollection,
  STACItem,
  STACSearchParams,
  TileParams,
} from '../api/types';

interface UsePlanetaryComputerOptions {
  /** STAC API base URL */
  stacApiUrl?: string;
  /** TiTiler API base URL */
  tilerApiUrl?: string;
  /** Auto-load collections on mount */
  autoLoadCollections?: boolean;
}

interface UsePlanetaryComputerReturn {
  /** All available collections */
  collections: STACCollection[];
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Load all collections */
  loadCollections: () => Promise<STACCollection[]>;
  /** Search for items */
  search: (params: STACSearchParams) => Promise<STACItem[]>;
  /** Get tile URL for an item */
  getItemTileUrl: (collectionId: string, itemId: string, params?: TileParams) => string;
  /** Get tile URL for a collection mosaic */
  getCollectionTileUrl: (collectionId: string, params?: TileParams) => string;
  /** Get signed download URL */
  getDownloadUrl: (url: string, collectionId: string) => Promise<string>;
  /** Get collection by ID */
  getCollection: (collectionId: string) => Promise<STACCollection>;
  /** Get item by ID */
  getItem: (collectionId: string, itemId: string) => Promise<STACItem>;
}

/**
 * React hook for interacting with Planetary Computer APIs.
 * Provides methods for browsing collections, searching, and generating tile URLs.
 *
 * @param options - Hook configuration options.
 * @returns Object with data and methods for Planetary Computer interaction.
 *
 * @example
 * ```tsx
 * function App() {
 *   const { collections, search, getItemTileUrl } = usePlanetaryComputer();
 *
 *   const handleSearch = async () => {
 *     const items = await search({
 *       collections: ['sentinel-2-l2a'],
 *       bbox: [-122.5, 37.5, -122, 38],
 *       datetime: '2024-01-01/2024-12-31',
 *     });
 *     console.log('Found items:', items);
 *   };
 *
 *   return <button onClick={handleSearch}>Search</button>;
 * }
 * ```
 */
export function usePlanetaryComputer(
  options: UsePlanetaryComputerOptions = {}
): UsePlanetaryComputerReturn {
  const { stacApiUrl, tilerApiUrl, autoLoadCollections = true } = options;

  const [collections, setCollections] = useState<STACCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Initialize clients
  const stacClient = useRef(new STACClient(stacApiUrl));
  const tilerClient = useRef(new TiTilerClient(tilerApiUrl));
  const sasManager = useRef(new SASTokenManager());

  /**
   * Loads all available collections.
   */
  const loadCollections = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await stacClient.current.getCollections();
      setCollections(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load collections');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Searches for items matching parameters.
   */
  const search = useCallback(async (params: STACSearchParams) => {
    setLoading(true);
    setError(null);

    try {
      return await stacClient.current.search(params);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Search failed');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Gets a tile URL for a STAC item.
   */
  const getItemTileUrl = useCallback(
    (collectionId: string, itemId: string, params: TileParams = {}) => {
      return tilerClient.current.getItemTileUrl(collectionId, itemId, params);
    },
    []
  );

  /**
   * Gets a tile URL for a collection mosaic.
   */
  const getCollectionTileUrl = useCallback(
    (collectionId: string, params: TileParams = {}) => {
      return tilerClient.current.getCollectionTileUrl(collectionId, params);
    },
    []
  );

  /**
   * Gets a signed download URL for an asset.
   */
  const getDownloadUrl = useCallback(async (url: string, collectionId: string) => {
    return sasManager.current.signUrl(url, collectionId);
  }, []);

  /**
   * Gets a collection by ID.
   */
  const getCollection = useCallback(async (collectionId: string) => {
    setLoading(true);
    setError(null);

    try {
      return await stacClient.current.getCollection(collectionId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to get collection');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Gets an item by ID.
   */
  const getItem = useCallback(async (collectionId: string, itemId: string) => {
    setLoading(true);
    setError(null);

    try {
      return await stacClient.current.getItem(collectionId, itemId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to get item');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load collections on mount
  useEffect(() => {
    if (autoLoadCollections) {
      loadCollections().catch(() => {
        // Error is already set in state
      });
    }
  }, [autoLoadCollections, loadCollections]);

  return {
    collections,
    loading,
    error,
    loadCollections,
    search,
    getItemTileUrl,
    getCollectionTileUrl,
    getDownloadUrl,
    getCollection,
    getItem,
  };
}
