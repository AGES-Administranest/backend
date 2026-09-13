import { SubIdCache } from './sub-id-cache';

describe('SubIdCache', () => {
  const ttl = 1000;
  let clock: number;
  let cache: SubIdCache;

  // Time is a constructor argument, so moving it is assignment rather than
  // jest.useFakeTimers() — which would also have to be undone afterwards.
  const advance = (ms: number) => (clock += ms);

  beforeEach(() => {
    clock = 0;
    cache = new SubIdCache(ttl, 3, () => clock);
  });

  it('knows nothing about a sub it has not seen', () => {
    expect(cache.get('sub-ana')).toBeUndefined();
  });

  it('returns the id while the entry is fresh', () => {
    cache.set('sub-ana', 'user-1');
    advance(ttl - 1);

    expect(cache.get('sub-ana')).toBe('user-1');
  });

  it('forgets the id once the ttl has passed', () => {
    cache.set('sub-ana', 'user-1');
    advance(ttl);

    expect(cache.get('sub-ana')).toBeUndefined();
  });

  it('drops the expired entry instead of holding the memory', () => {
    cache.set('sub-ana', 'user-1');
    advance(ttl);
    cache.get('sub-ana');

    expect(cache.size).toBe(0);
  });

  it('restarts the countdown when the same sub is written again', () => {
    cache.set('sub-ana', 'user-1');
    advance(ttl - 1);
    cache.set('sub-ana', 'user-1');
    advance(ttl - 1);

    expect(cache.get('sub-ana')).toBe('user-1');
  });

  it('evicts the oldest entry when it runs out of room', () => {
    cache.set('sub-1', 'user-1');
    cache.set('sub-2', 'user-2');
    cache.set('sub-3', 'user-3');
    cache.set('sub-4', 'user-4');

    expect(cache.size).toBe(3);
    expect(cache.get('sub-1')).toBeUndefined();
    expect(cache.get('sub-4')).toBe('user-4');
  });

  it('counts a rewritten sub as recent for eviction', () => {
    cache.set('sub-1', 'user-1');
    cache.set('sub-2', 'user-2');
    cache.set('sub-3', 'user-3');
    cache.set('sub-1', 'user-1');
    cache.set('sub-4', 'user-4');

    expect(cache.get('sub-1')).toBe('user-1');
    expect(cache.get('sub-2')).toBeUndefined();
  });

  it('forgets a sub on demand', () => {
    cache.set('sub-ana', 'user-1');
    cache.delete('sub-ana');

    expect(cache.get('sub-ana')).toBeUndefined();
  });
});
