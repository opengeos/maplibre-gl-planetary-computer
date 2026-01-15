import { describe, it, expect } from 'vitest';
import {
  generateId,
  clamp,
  formatDate,
  formatDateTime,
  truncate,
  formatBbox,
  classNames,
  isValidBbox,
  formatFileSize,
} from '../src/lib/utils/helpers';

describe('generateId', () => {
  it('generates unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('includes prefix when provided', () => {
    const id = generateId('test');
    expect(id).toMatch(/^test-/);
  });

  it('generates ID without prefix', () => {
    const id = generateId();
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('clamp', () => {
  it('clamps value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps value to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps value to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles negative ranges', () => {
    expect(clamp(0, -10, -5)).toBe(-5);
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2024-01-15T12:00:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('Unknown');
  });

  it('returns Unknown for null', () => {
    expect(formatDate(null)).toBe('Unknown');
  });

  it('returns Unknown for undefined', () => {
    expect(formatDate(undefined)).toBe('Unknown');
  });
});

describe('formatDateTime', () => {
  it('formats ISO datetime string', () => {
    const result = formatDateTime('2024-01-15T12:30:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('Unknown');
  });

  it('returns Unknown for null', () => {
    expect(formatDateTime(null)).toBe('Unknown');
  });
});

describe('truncate', () => {
  it('truncates long strings', () => {
    const result = truncate('This is a long string', 10);
    expect(result).toBe('This is a ...');
  });

  it('does not truncate short strings', () => {
    const result = truncate('Short', 10);
    expect(result).toBe('Short');
  });

  it('handles exact length', () => {
    const result = truncate('Exact', 5);
    expect(result).toBe('Exact');
  });
});

describe('formatBbox', () => {
  it('formats bbox array', () => {
    const result = formatBbox([-122.5, 37.5, -122.0, 38.0]);
    expect(result).toBe('-122.50, 37.50, -122.00, 38.00');
  });
});

describe('classNames', () => {
  it('returns active class names', () => {
    const result = classNames({
      active: true,
      disabled: false,
      selected: true,
    });
    expect(result).toBe('active selected');
  });

  it('returns empty string for all false', () => {
    const result = classNames({
      active: false,
      disabled: false,
    });
    expect(result).toBe('');
  });
});

describe('isValidBbox', () => {
  it('returns true for valid bbox', () => {
    expect(isValidBbox([-122.5, 37.5, -122.0, 38.0])).toBe(true);
  });

  it('returns false for wrong length', () => {
    expect(isValidBbox([-122.5, 37.5, -122.0])).toBe(false);
  });

  it('returns false for non-array', () => {
    expect(isValidBbox('not an array')).toBe(false);
  });

  it('returns false for non-numeric values', () => {
    expect(isValidBbox([-122.5, 'invalid', -122.0, 38.0])).toBe(false);
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('handles zero', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });
});
