import type { STACAsset, STACItem } from '../api/types';

/**
 * A STAC item stripped down to its bbox and data asset hrefs.
 */
export interface MinimalStacFeature {
  bbox: number[];
  assets: Record<string, { href: string }>;
}

/**
 * A FeatureCollection of {@link MinimalStacFeature}.
 */
export interface MinimalStacCollection {
  type: 'FeatureCollection';
  features: MinimalStacFeature[];
}

/**
 * Generates a unique ID with optional prefix.
 *
 * @param prefix - Optional prefix for the ID.
 * @returns Unique identifier string.
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}-${timestamp}-${randomPart}` : `${timestamp}-${randomPart}`;
}

/**
 * Debounces a function call.
 *
 * @param fn - Function to debounce.
 * @param delay - Delay in milliseconds.
 * @returns Debounced function.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttles a function call.
 *
 * @param fn - Function to throttle.
 * @param limit - Time limit in milliseconds.
 * @returns Throttled function.
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Clamps a value between min and max.
 *
 * @param value - Value to clamp.
 * @param min - Minimum value.
 * @param max - Maximum value.
 * @returns Clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Formats a date string for display.
 *
 * @param dateStr - ISO date string.
 * @returns Formatted date string.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

/**
 * Gets the best available date from STAC item properties.
 * Checks datetime, start_datetime, and end_datetime in order.
 *
 * @param properties - STAC item properties.
 * @returns Date string or null.
 */
export function getItemDate(properties: Record<string, unknown>): string | null {
  return (
    (properties.datetime as string | null) ||
    (properties.start_datetime as string | undefined) ||
    (properties.end_datetime as string | undefined) ||
    null
  );
}

/**
 * Formats a datetime string for display.
 *
 * @param dateStr - ISO datetime string.
 * @returns Formatted datetime string.
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

/**
 * Truncates a string to a maximum length.
 *
 * @param text - String to truncate.
 * @param maxLength - Maximum length.
 * @returns Truncated string.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Formats a bounding box for display.
 *
 * @param bbox - Bounding box [west, south, east, north].
 * @returns Formatted bbox string.
 */
export function formatBbox(bbox: [number, number, number, number]): string {
  const [w, s, e, n] = bbox;
  return `${w.toFixed(2)}, ${s.toFixed(2)}, ${e.toFixed(2)}, ${n.toFixed(2)}`;
}

/**
 * Builds CSS class string from conditions.
 *
 * @param classes - Object mapping class names to boolean conditions.
 * @returns Space-separated class string.
 */
export function classNames(classes: Record<string, boolean>): string {
  return Object.entries(classes)
    .filter(([, condition]) => condition)
    .map(([className]) => className)
    .join(' ');
}

/**
 * Checks if a value is a valid bbox.
 *
 * @param bbox - Value to check.
 * @returns True if valid bbox.
 */
export function isValidBbox(
  bbox: unknown
): bbox is [number, number, number, number] {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  return bbox.every((v) => typeof v === 'number' && isFinite(v));
}

/**
 * Media types that identify an asset as a downloadable raster.
 * Used as a fallback when items do not declare asset roles.
 */
const RASTER_MEDIA_TYPES = ['tiff', 'geotiff', 'cog'];

/**
 * Checks if an asset holds the item's actual data (as opposed to a thumbnail,
 * an overview, or a tile endpoint).
 */
function isDataAsset(asset: STACAsset): boolean {
  if (asset.roles?.length) return asset.roles.includes('data');
  const type = (asset.type || '').toLowerCase();
  return RASTER_MEDIA_TYPES.some((t) => type.includes(t));
}

/**
 * Reduces STAC items to a minimal FeatureCollection holding only each item's
 * bbox and the hrefs of its data assets.
 *
 * The result is a fraction of the size of the full STAC response, which makes
 * it practical to hand off to tools that only need to know where the source
 * rasters live (mosaic builders, download scripts, and the like). Items whose
 * assets are all thumbnails or previews are dropped.
 *
 * @param items - STAC items to reduce.
 * @returns Minimal FeatureCollection.
 */
export function toMinimalStacJson(items: STACItem[]): MinimalStacCollection {
  const features: MinimalStacFeature[] = [];

  for (const item of items) {
    const assets: Record<string, { href: string }> = {};

    for (const [key, asset] of Object.entries(item.assets ?? {})) {
      if (asset?.href && isDataAsset(asset)) {
        assets[key] = { href: asset.href };
      }
    }

    if (Object.keys(assets).length === 0) continue;

    features.push({ bbox: item.bbox, assets });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Formats file size for display.
 *
 * @param bytes - Size in bytes.
 * @returns Formatted size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
