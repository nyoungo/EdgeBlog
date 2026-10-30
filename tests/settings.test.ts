import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { mergeSettings } from '../functions/lib/settings';

/**
 * `mergeSettings` is what protects a partially-filled `settings` table from
 * taking the site down. Every deployment upgrade adds new nested keys, so the
 * important contract is: missing keys fall back to defaults, supplied keys win.
 */
describe('mergeSettings', () => {
  it('returns the full defaults for an empty table', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial namespace without dropping sibling defaults', () => {
    const merged = mergeSettings({ site: { name: 'My Blog' } });
    expect(merged.site.name).toBe('My Blog');
    expect(merged.site.tagline).toBe(DEFAULT_SETTINGS.site.tagline);
    expect(merged.site.logo).toEqual(DEFAULT_SETTINGS.site.logo);
  });

  it('replaces arrays wholesale instead of merging them by index', () => {
    const merged = mergeSettings({
      social: [{ id: 'x', label: 'X', type: 'x', url: 'https://x.example' }],
    });
    expect(merged.social).toEqual([{ id: 'x', label: 'X', type: 'x', url: 'https://x.example' }]);
  });

  it('ignores unknown namespaces and non-object values', () => {
    const merged = mergeSettings({ nope: { a: 1 }, site: 'oops' });
    expect(merged.site).toEqual(DEFAULT_SETTINGS.site);
    expect('nope' in merged).toBe(false);
  });

  it('does not let a stored row poison Object.prototype', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    mergeSettings({ site: polluted });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a nested value that is explicitly set to false/null', () => {
    const merged = mergeSettings({
      features: { comments: false, rss: false },
      comments: { requireModeration: false },
    });
    expect(merged.features.comments).toBe(false);
    expect(merged.features.rss).toBe(false);
    expect(merged.comments.requireModeration).toBe(false);
  });
});
