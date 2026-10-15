// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BodyStore } from '../src/body-store';
function fixture() {
  const files = new Map<string, string>([['old.json', JSON.stringify({ a: 'Offline A', b: 'Offline B' })]]);
  const adapter = { exists: vi.fn(async (p: string) => files.has(p)), read: vi.fn(async (p: string) => files.get(p)!), write: vi.fn(async (p: string, text: string) => { files.set(p, text); }), mkdir: vi.fn(async () => {}), stat: vi.fn(async () => null), list: vi.fn(async () => ({ files: [...files.keys()], folders: [] })) };
  return { files, adapter, store: new BodyStore(adapter, 'bodies', 'old.json') };
}
describe('lazy offline body store', () => {
  it('does no startup IO and reads legacy bodies on demand', async () => {
    const { store, adapter } = fixture(); expect(adapter.read).not.toHaveBeenCalled();
    expect(await store.get('a')).toBe('Offline A'); expect(await store.get('b')).toBe('Offline B');
    expect(adapter.read).toHaveBeenCalledTimes(1);
  });
  it('preserves unloaded bodies through migration and reads one shard after restart', async () => {
    const { store, adapter, files } = fixture();
    await store.write({ c: 'New C' }, new Set(['a', 'b', 'c']));
    expect(files.has('old.json')).toBe(true);
    adapter.read.mockClear();
    const next = new BodyStore(adapter, 'bodies', 'old.json');
    expect(await next.get('b')).toBe('Offline B');
    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(adapter.read).not.toHaveBeenCalledWith('old.json');
  });
  it('does not mark a partial migration ready, and retries without losing offline content', async () => {
    const { store, adapter, files } = fixture();
    adapter.write.mockRejectedValueOnce(new Error('Disk full'));
    await expect(store.write({ c: 'C' }, new Set(['a', 'b', 'c']))).rejects.toThrow('Disk full');
    expect(files.has('bodies/ready.json')).toBe(false);
    expect(await new BodyStore(adapter, 'bodies', 'old.json').get('a')).toBe('Offline A');
    await store.write({ c: 'C' }, new Set(['a', 'b', 'c']));
    expect(await store.get('c')).toBe('C');
  });
  it('clears requested bodies, keeps protected copies, and prunes removed articles', async () => {
    const { store } = fixture(); await store.write({}, new Set(['a', 'b']));
    store.remove(['a', 'b']); await store.write({ b: 'Protected B' }, new Set(['a', 'b']));
    expect(await store.get('a')).toBeUndefined(); expect(await store.get('b')).toBe('Protected B');
    await store.write({}, new Set(['a'])); expect(await store.get('b')).toBeUndefined();
  });
});
it('bounds existing unloaded bodies after restart while preserving saved articles', async () => {
  const { adapter } = fixture(); const store = new BodyStore(adapter, 'bodies', 'old.json', 10);
  const evicted = await store.write({ c: 'New body' }, new Set(['a', 'b', 'c']), new Set(['b']));
  expect(evicted).toContain('a'); expect(await store.get('b')).toBe('Offline B'); expect(await store.get('c')).toBe('New body');
  const next = new BodyStore(adapter, 'bodies', 'old.json', 10);
  await next.write({ d: 'Another' }, new Set(['a', 'b', 'c', 'd']), new Set(['b']));
  expect(await next.get('c')).toBeUndefined(); expect(await next.get('b')).toBe('Offline B');
});
