import { requestUrl, type Vault } from 'obsidian';
import { safeUrl } from './model';
import { t } from './i18n';
import { svgPng } from './svg-image';
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_CACHE = 64 * 1024 * 1024;
export function imageMime(data: ArrayBuffer): string | null {
  const bytes = new Uint8Array(data);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'image/x-icon';
  if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4))) return 'image/avif';
  return null;
}
export class LocalImages {
  private pending = new Map<string, Promise<Blob>>();
  private queue: Promise<void> = Promise.resolve();
  private ready = new Map<string, Blob>();
  private queuedBytes = 0;
  private queuedWrites = 0;
  private generation = 0;
  flush() { return this.queue; }
  dispose() { this.generation++; this.ready.clear(); }
  constructor(private vault: Vault, private directory: string) {}
  load(url: string, refresh = false): Promise<Blob> {
    const safe = safeUrl(url);
    if (!safe) return Promise.reject(new Error(t('error.imageUrlInvalid')));
    const downloaded = this.ready.get(safe);
    if (downloaded && !refresh) return Promise.resolve(downloaded);
    const existing = this.pending.get(safe);
    if (existing) return existing;
    const promise = this.read(safe, refresh).finally(() => this.pending.delete(safe));
    this.pending.set(safe, promise); return promise;
  }
  private async read(url: string, refresh: boolean): Promise<Blob> {
    const generation = this.generation;
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const path = `${this.directory}/${hash}.img`;
    let data: ArrayBuffer | null = null;
    try { if (!refresh && await this.vault.adapter.exists(path)) data = await this.vault.adapter.readBinary(path); } catch { /* Refetch a missing cache file. */ }
    if (data && imageMime(data)) return new Blob([data], { type: imageMime(data) || 'image/png' });
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        requestUrl({ url, method: 'GET', throw: false }),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(t('error.imageTimeout'))), 20000); }),
      ]);
      if (response.status < 200 || response.status >= 300) throw new Error(t('error.imageLoadFailed'));
      data = response.arrayBuffer;
    } finally { window.clearTimeout(timer); }
    if (data.byteLength > MAX_IMAGE) throw new Error(t('error.imageUnsupported'));
    if (!imageMime(data)) data = await svgPng(data);
    const type = data && imageMime(data);
    if (!data || !type || data.byteLength > MAX_IMAGE) throw new Error(t('error.imageUnsupported'));
    const bytes = data, blob = new Blob([bytes], { type });
    // A slow disk must neither delay display nor cause a duplicate download.
    // Bound buffers waiting for storage; the rendered blob remains usable if caching is skipped.
    if (generation !== this.generation || this.queuedBytes + bytes.byteLength > 32 * 1024 * 1024 || this.queuedWrites >= 16) return blob;
    this.ready.set(url, blob); this.queuedBytes += bytes.byteLength; this.queuedWrites++;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      if (generation !== this.generation) return;
      if (!await this.vault.adapter.exists(this.directory)) await this.vault.adapter.mkdir(this.directory);
      await this.vault.adapter.writeBinary(path, bytes);
      // Only the last queued write scans/evicts the cache, not every downloaded image.
      if (this.queuedWrites > 1) return;
      const { files } = await this.vault.adapter.list(this.directory);
      const items = (await Promise.all(files.filter(file => /\/[a-f0-9]{64}\.img$/.test(file)).map(async file => ({ file, stat: await this.vault.adapter.stat(file) })))).sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));
      let total = 0;
      for (const [index, item] of items.entries()) {
        total += item.stat?.size || 0;
        if (index >= 100 || total > MAX_CACHE) await this.vault.adapter.remove(item.file);
      }
    }).catch(() => undefined).finally(() => {
      this.queuedBytes -= bytes.byteLength; this.queuedWrites--;
      if (this.ready.get(url) === blob) this.ready.delete(url);
    });
    return blob;
  }
  async usage(): Promise<{ files: number; bytes: number }> {
    try {
      if (!await this.vault.adapter.exists(this.directory)) return { files: 0, bytes: 0 };
      const { files } = await this.vault.adapter.list(this.directory);
      const images = files.filter(file => /\/[a-f0-9]{64}\.img$/.test(file));
      const bytes = (await Promise.all(images.map(async file => { try { return (await this.vault.adapter.stat(file))?.size ?? 0; } catch { return 0; } })))
        .reduce((total, size) => total + size, 0);
      return { files: images.length, bytes };
    } catch { return { files: 0, bytes: 0 }; }
  }
  async clear(): Promise<{ files: number; bytes: number }> {
    this.generation++; this.ready.clear();
    await this.flush();
    const usage = await this.usage();
    try { if (await this.vault.adapter.exists(this.directory)) await this.vault.adapter.rmdir(this.directory, true); } catch { /* Keep settings flowing if the folder cannot be removed. */ }
    return usage;
  }
}
