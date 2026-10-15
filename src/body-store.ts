import { t } from './i18n';
import type { DataAdapter } from 'obsidian';

/** Lazy sharded bodies. The legacy file remains a rollback copy after migration. */
export class BodyStore {
  private mode?: Promise<boolean>;
  private legacy?: Promise<Record<string, string>>;
  private shards = new Map<number, Promise<Record<string, string>>>();
  private known?: Set<string>;
  private sizes?: Map<string, number>;
  private removed = new Set<string>();
  constructor(private adapter: Pick<DataAdapter, 'exists' | 'read' | 'write' | 'mkdir' | 'stat' | 'list'>, private directory: string, private legacyPath: string, private maxBytes = 20 * 1024 * 1024) {}
  private bucket(id: string) { let hash = 2166136261; for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619); return (hash >>> 0) % 32; }
  private path(bucket: number) { return `${this.directory}/${bucket}.json`; }
  private modern() { return this.mode ??= this.adapter.exists(`${this.directory}/ready.json`); }
  private async read(path: string): Promise<Record<string, string>> {
    if (!await this.adapter.exists(path)) return {};
    const value: unknown = JSON.parse(await this.adapter.read(path));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('reader.contentFailed'));
    return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  }
  private shard(bucket: number) {
    let result = this.shards.get(bucket);
    if (!result) { result = this.read(this.path(bucket)); this.shards.set(bucket, result); }
    else { this.shards.delete(bucket); this.shards.set(bucket, result); }
    for (const key of this.shards.keys()) { if (this.shards.size <= 4) break; this.shards.delete(key); }
    return result;
  }
  async get(id: string): Promise<string | undefined> {
    if (this.removed.has(id)) return undefined;
    const values = await this.modern() ? await this.shard(this.bucket(id)) : await (this.legacy ??= this.read(this.legacyPath));
    return Object.hasOwn(values, id) ? values[id] : undefined;
  }
  remove(ids: string[]) { for (const id of ids) this.removed.add(id); }
  async write(bodies: Record<string, string>, retained: Set<string>, protectedIds = new Set<string>()) {
    const removals = new Set(this.removed);
    const changed = new Map<number, Record<string, string>>();
    for (const [id, body] of Object.entries(bodies)) {
      const bucket = this.bucket(id), values = changed.get(bucket) || {};
      Object.defineProperty(values, id, { value: body, enumerable: true, writable: true, configurable: true }); changed.set(bucket, values);
    }
    const modern = await this.modern();
    if (!await this.adapter.exists(this.directory)) await this.adapter.mkdir(this.directory);
    const legacy = modern ? null : await (this.legacy ??= this.read(this.legacyPath));
    if (!this.sizes) {
      const sizes = new Map<string, number>();
      const record = (values: Record<string, string>) => { for (const [id, body] of Object.entries(values)) sizes.set(id, new TextEncoder().encode(body).length); };
      if (legacy) record(legacy);
      else for (let bucket = 0; bucket < 32; bucket++) record(await this.shard(bucket));
      this.sizes = sizes;
    }
    const sizes = new Map(this.sizes);
    for (const id of sizes.keys()) if (!retained.has(id) || removals.has(id)) sizes.delete(id);
    for (const [id, body] of Object.entries(bodies)) { sizes.delete(id); sizes.set(id, new TextEncoder().encode(body).length); }
    let bytes = [...sizes].reduce((sum, [id, size]) => sum + (protectedIds.has(id) ? 0 : size), 0);
    const evicted: string[] = [];
    for (const [id, size] of sizes) {
      if (bytes <= this.maxBytes) break;
      if (protectedIds.has(id)) continue;
      sizes.delete(id); removals.add(id); evicted.push(id); bytes -= size;
      const values = changed.get(this.bucket(id)); if (values) delete values[id];
    }
    if (this.known) for (const id of this.known) if (!retained.has(id)) removals.add(id);
    const buckets = !modern || !this.known ? Array.from({ length: 32 }, (_, i) => i) : [...new Set([...changed.keys(), ...[...removals].map(id => this.bucket(id))])];
    for (const bucket of buckets) {
      const previous = legacy ? Object.fromEntries(Object.entries(legacy).filter(([id]) => this.bucket(id) === bucket)) : await this.shard(bucket);
      const next = { ...previous };
      for (const id of Object.keys(next)) if (!retained.has(id) || removals.has(id)) delete next[id];
      for (const [id, body] of Object.entries(changed.get(bucket) || {})) Object.defineProperty(next, id, { value: body, enumerable: true, configurable: true, writable: true });
      if (!modern || JSON.stringify(next) !== JSON.stringify(previous)) {
        await this.adapter.write(this.path(bucket), JSON.stringify(next));
        this.shards.delete(bucket);
      }
      // Keep migration and large refreshes interruptible by input/rendering.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
    if (!modern) { await this.adapter.write(`${this.directory}/ready.json`, '{"version":1}'); this.mode = Promise.resolve(true); this.legacy = undefined; }
    this.known = retained; this.sizes = sizes;
    for (const id of removals) this.removed.delete(id);
    return evicted;
  }
  async bytes() {
    if (!await this.modern()) return (await this.adapter.stat(this.legacyPath))?.size || 0;
    const { files } = await this.adapter.list(this.directory);
    const stats = await Promise.all(files.map(file => this.adapter.stat(file)));
    return stats.reduce((sum, value) => sum + (value?.size || 0), 0);
  }
}
