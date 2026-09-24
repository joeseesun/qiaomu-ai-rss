import { Component, setIcon } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { safeUrl } from './model';
export interface SourceMark { name: string; site?: string; url?: string; image?: string; kind?: string }
export function faviconUrl(source: SourceMark): string | null {
  const site = safeUrl(source.site || source.url || ''); if (!site) return null;
  const parsed = new URL(site);
  if (/wechat2rss|weread|rsshub|feeds\./i.test(parsed.hostname) || /\/weread\//.test(parsed.pathname) || source.kind === 'wechat') return null;
  return `${parsed.origin}/favicon.ico`;
}
export class SourceIcons extends Component {
  private urls: string[] = [];
  private observer?: IntersectionObserver;
  private tasks: (() => Promise<void>)[] = [];
  private active = 0;
  private generation = 0;
  private failed = new Set<string>();
  private pending = new WeakMap<Element, () => void>();
  constructor(private plugin: QiaomuRssPlugin) { super(); }
  clear() { this.generation++; this.observer?.disconnect(); this.observer = undefined; this.tasks = []; for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }
  onunload() { this.clear(); }
  render(parent: HTMLElement, source: SourceMark) {
    const mark = parent.createSpan({ cls: 'qrs-source-mark', attr: { 'aria-hidden': 'true' } });
    if (source.kind === 'vault') { setIcon(mark, source.name.endsWith('.md') ? 'file-text' : 'folder-open'); return; }
    mark.setText(Array.from(source.name.trim())[0]?.toLocaleUpperCase() || 'R');
    if (!this.plugin.state.settings.remoteImages) return;
    const urls = [safeUrl(source.image || ''), faviconUrl(source)].filter((u): u is string => !!u && !this.failed.has(u));
    if (!urls.length) return;
    const generation = this.generation;
    const start = () => { this.tasks.push(async () => {
      for (const url of urls) {
        if (generation !== this.generation || !mark.isConnected) return;
        try {
          const blob = await this.plugin.images.load(url);
          if (generation !== this.generation || !mark.isConnected) return;
          const objectUrl = URL.createObjectURL(blob); this.urls.push(objectUrl);
          const img = mark.createEl('img', { attr: { src: objectUrl, alt: '', decoding: 'async' } });
          img.onload = () => mark.addClass('has-image'); img.onerror = () => { img.remove(); mark.removeClass('has-image'); };
          return;
        } catch { this.failed.add(url); }
      }
    }); this.drain(); };
    if (!this.observer) this.observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { this.observer?.unobserve(e.target); this.pending.get(e.target)?.(); this.pending.delete(e.target); } });
    this.pending.set(mark, start); this.observer.observe(mark);
  }
  private drain() { while (this.active < 4 && this.tasks.length) { const task = this.tasks.shift()!; this.active++; void task().finally(() => { this.active--; this.drain(); }); } }
}
