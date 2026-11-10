import { describe, expect, it } from 'vitest';
import { resolveSearchQuery } from '../functions/lib/search-query';

describe('resolveSearchQuery', () => {
  it('keeps a complete query untouched', () => {
    expect(resolveSearchQuery('雷军')).toBe('雷军');
    expect(resolveSearchQuery('  小米SU7 价格  ')).toBe('小米SU7 价格');
  });

  it('restores the full keyword when the model truncated it to one character', () => {
    expect(resolveSearchQuery('雷', '帮我搜索雷军')).toBe('雷军');
    expect(resolveSearchQuery('雷', '查一下雷军最近的消息')).toBe('雷军最近的消息');
  });

  it('strips command prefixes before searching', () => {
    expect(resolveSearchQuery('搜', '请帮我搜一下小米汽车')).toBe('小米汽车');
  });

  it('returns the single character when no context is available', () => {
    expect(resolveSearchQuery('雷')).toBe('雷');
    expect(resolveSearchQuery('雷', '讲个笑话')).toBe('雷');
  });

  it('returns an empty string for blank input', () => {
    expect(resolveSearchQuery('   ', '帮我搜索雷军')).toBe('');
  });
});
