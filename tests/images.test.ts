// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { requestUrl } from './obsidian-mock';
import type { Vault } from 'obsidian';
Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle });
import { imageMime, LocalImages } from '../src/images';
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
    expect(requestUrl).toHaveBeenCalledTimes(1); expect(files.size).toBe(1);
    requestUrl.mockRejectedValue(new Error('offline'));
    const blob = await images.load('https://example.com/photo.png');
    expect(blob.type).toBe('image/png'); expect(requestUrl).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized responses and enforces the file count cap', async () => {
    requestUrl.mockReset(); const oversized = new Uint8Array(9*1024*1024); oversized.set([137,80,78,71]);
    requestUrl.mockResolvedValue({status:200,arrayBuffer:oversized.buffer});
    const {images, files}=cache();
    await expect(images.load('https://example.com/large')).rejects.toThrow('8 MB'); expect(files.size).toBe(0);
    for(let i=0;i<102;i++)files.set('cache/'+i.toString(16).padStart(64,'0')+'.img',new Uint8Array([1]).buffer);
    requestUrl.mockResolvedValue({status:200,arrayBuffer:new Uint8Array([137,80,78,71]).buffer});
    await images.load('https://example.com/small'); expect(files.size).toBe(100);
  });
});
