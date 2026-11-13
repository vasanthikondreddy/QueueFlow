import { describe, expect, test } from 'vitest';
import { formatDuration, toMinutes, bucketLabel } from '../src/utils/format.js';

describe('format utils', () => {
  test('formatDuration', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
  test('toMinutes keeps null and rounds to 1 decimal', () => {
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes(90_000)).toBe(1.5);
  });
  test('bucketLabel formats hourly keys', () => {
    expect(bucketLabel('2026-11-13T09')).toBe('09:00');
  });
});
