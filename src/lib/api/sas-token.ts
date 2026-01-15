import type { SASTokenResponse } from './types';

const SAS_TOKEN_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/token';

interface TokenCache {
  token: string;
  expiry: Date;
}

/**
 * Manages SAS tokens for accessing Planetary Computer assets.
 * Implements token caching to minimize API calls.
 */
export class SASTokenManager {
  private cache: Map<string, TokenCache> = new Map();
  private bufferMs: number;

  /**
   * Creates a new SAS token manager.
   *
   * @param bufferMs - Buffer time before expiry to refresh token (default: 5 min).
   */
  constructor(bufferMs: number = 5 * 60 * 1000) {
    this.bufferMs = bufferMs;
  }

  /**
   * Gets a valid SAS token for the given collection.
   *
   * @param collectionId - Collection identifier.
   * @returns Promise resolving to SAS token string.
   */
  async getToken(collectionId: string): Promise<string> {
    const cached = this.cache.get(collectionId);
    const now = new Date();

    // Return cached token if still valid
    if (cached && cached.expiry.getTime() - now.getTime() > this.bufferMs) {
      return cached.token;
    }

    // Fetch new token
    const response = await fetch(`${SAS_TOKEN_URL}/${encodeURIComponent(collectionId)}`);

    if (!response.ok) {
      throw new Error(`Failed to get SAS token for ${collectionId}: ${response.statusText}`);
    }

    const data: SASTokenResponse = await response.json();
    const token = data.token;
    const expiry = new Date(data['msft:expiry']);

    // Cache the token
    this.cache.set(collectionId, { token, expiry });

    return token;
  }

  /**
   * Signs a URL with a SAS token.
   *
   * @param url - URL to sign.
   * @param collectionId - Collection identifier for token lookup.
   * @returns Promise resolving to signed URL.
   */
  async signUrl(url: string, collectionId: string): Promise<string> {
    const token = await this.getToken(collectionId);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${token}`;
  }

  /**
   * Checks if a token is cached and valid for a collection.
   *
   * @param collectionId - Collection identifier.
   * @returns True if a valid token is cached.
   */
  hasValidToken(collectionId: string): boolean {
    const cached = this.cache.get(collectionId);
    if (!cached) return false;

    const now = new Date();
    return cached.expiry.getTime() - now.getTime() > this.bufferMs;
  }

  /**
   * Clears the token cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clears the cached token for a specific collection.
   *
   * @param collectionId - Collection identifier.
   */
  clearToken(collectionId: string): void {
    this.cache.delete(collectionId);
  }
}
