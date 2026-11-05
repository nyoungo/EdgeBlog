import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings-defaults';
import { mergeSettings } from '../functions/lib/settings';
import { layoutSchema } from '../functions/api/settings-schemas';

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

  it('fills new hero video fields for layouts saved before they existed', () => {
    const merged = mergeSettings({
      layout: {
        hero: {
          backgroundVideoLoop: false,
          backgroundVideoStart: 4,
          backgroundVideoEnd: 12,
        },
      },
    });
    expect(merged.layout.hero.backgroundVideoStart).toBe(4);
    expect(merged.layout.hero.backgroundVideoEnd).toBe(12);
    expect(merged.layout.hero.backgroundVideoFirstFromStart).toBe(
      DEFAULT_SETTINGS.layout.hero.backgroundVideoFirstFromStart,
    );
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

/**
 * 顶栏三个颜色是后加的字段：旧库没有它们时靠默认值兜底，写回时又必须能通过
 * 校验（zod 的 object 会丢掉 schema 未声明的键，漏写就等于设置不生效）。
 */
describe('header colours', () => {
  it('defaults to empty strings so the header falls back to the theme', () => {
    expect(DEFAULT_SETTINGS.layout.header).toMatchObject({
      logoColor: '',
      navColor: '',
      actionColor: '',
    });
  });

  it('passes all three colours through layout validation', () => {
    const parsed = layoutSchema.parse({
      header: { logoColor: '#111111', navColor: '#222222', actionColor: '#333333' },
    }) as { header: Record<string, unknown> };
    expect(parsed.header).toEqual({
      logoColor: '#111111',
      navColor: '#222222',
      actionColor: '#333333',
    });
  });
});
