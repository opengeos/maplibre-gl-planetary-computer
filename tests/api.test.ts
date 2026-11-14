import { describe, it, expect, vi } from 'vitest';
import { STACClient, buildStacSearchQuery } from '../src/lib/api/stac-client';
import { TiTilerClient, buildMosaicSearchBody } from '../src/lib/api/titiler-client';
import { RENDER_CONFIGS } from '../src/lib/api/render-presets';
import type { STACCollection } from '../src/lib/api/types';

/** Builds a fetch mock that answers every request with the given JSON body. */
function jsonFetch(body: unknown, ok = true) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('buildStacSearchQuery', () => {
  it('encodes search parameters for GET /search', () => {
    const query = new URLSearchParams(
      buildStacSearchQuery({
        collections: ['sentinel-2-l2a', 'naip'],
        bbox: [-122.5, 47.5, -122.2, 47.7],
        datetime: '2024-06-01T00:00:00Z/2024-08-31T23:59:59Z',
        limit: 10,
        query: { 'eo:cloud_cover': { lte: 10 } },
        sortby: [
          { field: 'properties.datetime', direction: 'desc' },
          { field: 'properties.eo:cloud_cover', direction: 'asc' },
        ],
      })
    );

    expect(query.get('collections')).toBe('sentinel-2-l2a,naip');
    expect(query.get('bbox')).toBe('-122.5,47.5,-122.2,47.7');
    expect(query.get('datetime')).toBe('2024-06-01T00:00:00Z/2024-08-31T23:59:59Z');
    expect(query.get('limit')).toBe('10');
    expect(JSON.parse(query.get('query')!)).toEqual({ 'eo:cloud_cover': { lte: 10 } });
    expect(query.get('sortby')).toBe('-properties.datetime,+properties.eo:cloud_cover');
  });

  it('omits empty parameters and defaults the filter language', () => {
    expect(buildStacSearchQuery({})).toBe('');
    const query = new URLSearchParams(buildStacSearchQuery({ filter: { op: '=', args: [] } }));
    expect(query.get('filter-lang')).toBe('cql2-json');
  });
});

describe('STACClient', () => {
  it('searches with a preflight-free GET by default', async () => {
    const fetchMock = jsonFetch({ type: 'FeatureCollection', features: [{ id: 'a' }] });
    const client = new STACClient('https://stac.test/', { fetch: fetchMock });

    const items = await client.search({ collections: ['naip'], limit: 1 });

    expect(items).toEqual([{ id: 'a' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://stac.test/search?collections=naip&limit=1');
    expect(init?.method).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it('can POST the search when asked', async () => {
    const fetchMock = jsonFetch({ type: 'FeatureCollection', features: [] });
    const client = new STACClient('https://stac.test', { fetch: fetchMock, searchMethod: 'POST' });

    await client.searchWithContext({ collections: ['naip'] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://stac.test/search');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ collections: ['naip'] });
  });

  it('cancels the previous search when a new one starts', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      return { ok: true, json: async () => ({ features: [] }) };
    }) as unknown as typeof fetch;
    const client = new STACClient('https://stac.test', { fetch: fetchMock });

    await client.search({});
    await client.search({});

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('falls back to supplied collections when the live list fails', async () => {
    const fallback = [{ id: 'bundled' }] as STACCollection[];
    const onCollectionsFallback = vi.fn();
    const client = new STACClient('https://stac.test', {
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      fallbackCollections: async () => fallback,
      onCollectionsFallback,
    });

    await expect(client.getCollections()).resolves.toBe(fallback);
    expect(onCollectionsFallback).toHaveBeenCalledOnce();
  });

  it('rethrows a collection failure when there is no fallback', async () => {
    const client = new STACClient('https://stac.test', { fetch: jsonFetch({}, false) });
    await expect(client.getCollections()).rejects.toThrow('STAC API error: 500');
  });
});

describe('buildMosaicSearchBody', () => {
  it('translates a simple search into one CQL2 filter', () => {
    const body = buildMosaicSearchBody({
      collections: ['sentinel-2-l2a'],
      datetime: '2024-06-01T00:00:00Z/2024-08-31T23:59:59Z',
      query: { 'eo:cloud_cover': { lte: 10 } },
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    });

    expect(body).toEqual({
      'filter-lang': 'cql2-json',
      collections: ['sentinel-2-l2a'],
      filter: {
        op: 'and',
        args: [
          { op: '=', args: [{ property: 'collection' }, 'sentinel-2-l2a'] },
          {
            op: 'anyinteracts',
            args: [
              { property: 'datetime' },
              { interval: ['2024-06-01T00:00:00Z', '2024-08-31T23:59:59Z'] },
            ],
          },
          { op: '<=', args: [{ property: 'eo:cloud_cover' }, 10] },
        ],
      },
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    });
  });

  it('keeps a single condition unwrapped and handles open date ranges', () => {
    expect(buildMosaicSearchBody({ collections: ['naip'] }).filter).toEqual({
      op: '=',
      args: [{ property: 'collection' }, 'naip'],
    });
    expect(buildMosaicSearchBody({ datetime: '../2020-12-31T23:59:59Z' }).filter).toEqual({
      op: 'anyinteracts',
      args: [{ property: 'datetime' }, { interval: ['..', '2020-12-31T23:59:59Z'] }],
    });
  });
});

describe('TiTilerClient', () => {
  const tiler = new TiTilerClient('https://data.test/');

  it('builds mosaic tile URLs under the registered search id', () => {
    expect(tiler.getMosaicTileUrl('abc', { assets: ['visual'] }, 'sentinel-2-l2a')).toBe(
      'https://data.test/mosaic/abc/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=sentinel-2-l2a&assets=visual'
    );
    expect(tiler.getMosaicTileUrl('abc')).toBe(
      'https://data.test/mosaic/abc/tiles/WebMercatorQuad/{z}/{x}/{y}@1x'
    );
  });

  it('registers a mosaic and returns its tile URL', async () => {
    const fetchMock = jsonFetch({ searchid: 'pc1.123.hash' });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await tiler.registerMosaic(
        { collections: ['naip'], datetime: '2020-01-01T00:00:00Z/2020-12-31T23:59:59Z' },
        { assets: ['image'] }
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://data.test/mosaic/register');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string).filter.op).toBe('and');
      expect(result.searchId).toBe('pc1.123.hash');
      expect(result.tileUrl).toContain('/mosaic/pc1.123.hash/tiles/WebMercatorQuad/');
      expect(result.tileUrl).toContain('collection=naip');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('builds a GeoTIFF clip URL capped by max_size', () => {
    const url = tiler.getItemCropUrl('naip', 'item-1', [-122.4, 47.5, -122.3, 47.6], {
      assets: ['image'],
    });
    expect(url).toBe(
      'https://data.test/item/bbox/-122.4,47.5,-122.3,47.6.tif?collection=naip&item=item-1&assets=image&max_size=2048'
    );
  });
});

describe('render presets', () => {
  it('flags asset-level band math with asset_as_band', () => {
    // The Data API answers 500 for `(B08-B04)/(B08+B04)` unless asset_as_band
    // is set; expressions over bands of one asset (`image_b4`) must not set it.
    for (const config of RENDER_CONFIGS) {
      for (const preset of config.presets) {
        const expression = preset.params.expression;
        if (!expression) continue;
        const usesBandSuffix = /_b\d+\b/.test(expression);
        expect(Boolean(preset.params.asset_as_band), `${config.collectionId}/${preset.name}`).toBe(
          !usesBandSuffix
        );
      }
    }
  });
});
