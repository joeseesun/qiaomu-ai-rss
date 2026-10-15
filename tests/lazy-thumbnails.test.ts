// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { LazyThumbnails } from '../src/lazy-thumbnails';
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('starts only intersecting images, caps concurrency and drops detached queued rows', async () => {
  let intersect!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { intersect = callback; } observe() {} unobserve() {} disconnect = disconnect; });
  const root = document.createElement('div'); document.body.append(root);
  const lazy = new LazyThumbnails(root), release: (() => void)[] = [], load = vi.fn(() => new Promise<void>(resolve => release.push(resolve)));
  const rows = Array.from({ length: 5 }, () => { const row = document.createElement('div'); root.append(row); lazy.observe(row, load); return row; });
  expect(load).not.toHaveBeenCalled();
  intersect(rows.slice(0, 3).map(target => ({ target, isIntersecting: true })) as IntersectionObserverEntry[], {} as IntersectionObserver);
  expect(load).toHaveBeenCalledTimes(2); rows[2].remove();
  release[0](); await new Promise(resolve => setTimeout(resolve, 0));
  expect(load).toHaveBeenCalledTimes(2); lazy.dispose(); expect(disconnect).toHaveBeenCalledOnce(); release[1]();
});
