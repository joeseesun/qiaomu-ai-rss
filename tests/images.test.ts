// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { requestUrl } from './obsidian-mock';
import type { Vault } from 'obsidian';
Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle });
import { imageMime, LocalImages } from '../src/images';
import { svgPng } from '../src/svg-image';
vi.mock('../src/svg-image', () => ({ svgPng: vi.fn().mockResolvedValue(null) }));
describe('local image validation', () => {
  it('recognizes raster signatures rather than trusting a remote MIME header', () => {
    expect(imageMime(new Uint8Array([137,80,78,71,13,10,26,10]).buffer)).toBe('image/png');
    expect(imageMime(new Uint8Array([255,216,255,224]).buffer)).toBe('image/jpeg');
  });
  it('rejects executable and non-image responses', () => {
    for (const text of ['<svg onload="alert(1)"></svg>', '<html>Error</html>', '<script>run()</script>', 'not an image']) {
      expect(imageMime(new TextEncoder().encode(text).buffer)).toBeNull();
    }
  });
});

describe('bounded disk image cache', () => {
  function cache() {
    const files = new Map<string, ArrayBuffer>();
    let time = 0;
    const adapter = {
      exists: async (path: string) => path === 'cache' || files.has(path),
      readBinary: async (path: string) => files.get(path),
      writeBinary: async (path: string, value: ArrayBuffer) => { files.set(path, value); },
      mkdir: async () => {},
      list: async () => ({ files: [...files.keys()] }),
      stat: async (path: string) => ({ size: files.get(path)?.byteLength || 0, mtime: ++time }),
      remove: async (path: string) => { files.delete(path); },
    };
    return { files, images: new LocalImages({ adapter } as unknown as Vault, 'cache') };
  }
  it('deduplicates requests and reuses downloaded files offline', async () => {
    requestUrl.mockReset();
    requestUrl.mockResolvedValue({status: 200, arrayBuffer: new Uint8Array([137,80,78,71,13,10,26,10]).buffer});
    const {images, files} = cache();
    await Promise.all([images.load('https://example.com/photo.png'), images.load('https://example.com/photo.png')]);
    expect(requestUrl).toHaveBeenCalledTimes(1); await images.flush(); expect(files.size).toBe(1);
    requestUrl.mockRejectedValue(new Error('offline'));
    const blob = await images.load('https://example.com/photo.png');
    expect(blob.type).toBe('image/png'); expect(requestUrl).toHaveBeenCalledTimes(1);
  });
  it('converts SVG responses into cached PNGs usable offline without decoding SVG again', async () => {
    requestUrl.mockReset(); vi.mocked(svgPng).mockClear();
    const png = new Uint8Array([137,80,78,71,13,10,26,10]).buffer;
    vi.mocked(svgPng).mockResolvedValueOnce(png);
    requestUrl.mockResolvedValue({status:200,arrayBuffer:new TextEncoder().encode('<svg/>').buffer});
    const {images,files}=cache();
    const blob=await images.load('https://example.com/badge');
    await images.flush(); expect(blob.type).toBe('image/png'); expect([...files.values()][0]).toEqual(png);
    requestUrl.mockRejectedValue(new Error('offline'));
    expect((await images.load('https://example.com/badge')).type).toBe('image/png');
    expect(requestUrl).toHaveBeenCalledTimes(1); expect(svgPng).toHaveBeenCalledTimes(1);
  });
  it('refetches on explicit retry instead of repeatedly returning a broken cached image', async () => {
    requestUrl.mockReset();
    const png = new Uint8Array([137,80,78,71,13,10,26,10]).buffer;
    requestUrl.mockResolvedValue({status:200,arrayBuffer:png});
    const {images}=cache();
    await images.load('https://example.com/image');
    await images.load('https://example.com/image');
    expect(requestUrl).toHaveBeenCalledTimes(1);
    await images.load('https://example.com/image',true);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized responses and enforces the file count cap', async () => {
    requestUrl.mockReset(); const oversized = new Uint8Array(9*1024*1024); oversized.set([137,80,78,71]);
    requestUrl.mockResolvedValue({status:200,arrayBuffer:oversized.buffer});
    const {images, files}=cache();
    await expect(images.load('https://example.com/large')).rejects.toThrow('8 MB'); expect(files.size).toBe(0);
    for(let i=0;i<102;i++)files.set('cache/'+i.toString(16).padStart(64,'0')+'.img',new Uint8Array([1]).buffer);
    requestUrl.mockResolvedValue({status:200,arrayBuffer:new Uint8Array([137,80,78,71]).buffer});
    await images.load('https://example.com/small'); await images.flush(); expect(files.size).toBe(100);
  });
});
it('makes a downloaded image readable while disk storage is stalled, without redownloading', async () => {
  requestUrl.mockReset();
  requestUrl.mockResolvedValue({status:200,arrayBuffer:new Uint8Array([137,80,78,71]).buffer});
  let release!: () => void;
  const adapter = { exists: async () => false, mkdir: async () => {}, writeBinary: () => new Promise<void>(resolve => { release = resolve; }), list: async () => ({ files: [] }) };
  const images = new LocalImages({adapter} as unknown as Vault, 'cache');
  let readable = false;
  const first = images.load('https://example.com/slow-disk').then(blob => { readable = true; return blob; });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(readable).toBe(true);
  expect((await images.load('https://example.com/slow-disk')).type).toBe('image/png');
  expect(requestUrl).toHaveBeenCalledOnce();
  release(); await first;
});
it('clear waits for outstanding writes and blocks late downloads from repopulating disk', async () => {
  requestUrl.mockReset();
  let finish!: (value: unknown) => void;
  requestUrl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const adapter={exists:vi.fn(async()=>false),writeBinary:vi.fn(),list:async()=>({files:[]}),rmdir:vi.fn(),mkdir:vi.fn()};
  const images=new LocalImages({adapter} as unknown as Vault,'cache');
  const downloading=images.load('https://example.com/late'); await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  await images.clear(); finish({status:200,arrayBuffer:new Uint8Array([137,80,78,71]).buffer}); await downloading; await images.flush();
  expect(adapter.writeBinary).not.toHaveBeenCalled();
});
