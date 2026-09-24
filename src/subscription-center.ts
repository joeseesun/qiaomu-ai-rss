import { ItemView, Modal, type App, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { DiscoveryPanel } from './discovery-view';
import { LibraryPanel } from './library-view';

export type CenterTab = 'library' | 'discover';

// One large dialog for everything that changes subscriptions; reading stays in the reader.
export class SubscriptionCenter extends Modal {
  private tab: CenterTab;
  private panels: Partial<Record<CenterTab, { el: HTMLElement; panel: LibraryPanel | DiscoveryPanel }>> = {};
  private tabs!: HTMLElement;
  constructor(app: App, private plugin: QiaomuRssPlugin, tab: CenterTab) { super(app); this.tab = tab; }
  onOpen() {
    this.modalEl.addClass('qrs-modal', 'qrs-center');
    const head = this.contentEl.createDiv('qrs-center-head');
    this.tabs = head.createDiv({ cls: 'qrs-center-tabs', attr: { role: 'tablist', 'aria-label': '订阅中心' } });
    for (const [tab, label] of [['library', '订阅管理'], ['discover', '发现订阅']] as const) {
      const button = this.tabs.createEl('button', { text: label, attr: { role: 'tab', 'data-tab': tab } });
      button.onclick = () => this.show(tab);
      button.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const next = tab === 'library' ? 'discover' : 'library'; this.show(next); this.tabs.querySelector<HTMLElement>(`[data-tab=${next}]`)?.focus(); } };
    }
    this.contentEl.createDiv('qrs-center-body');
    this.show(this.tab);
  }
  show(tab: CenterTab) {
    this.tab = tab;
    const body = this.contentEl.querySelector<HTMLElement>('.qrs-center-body')!;
    for (const button of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    let current = this.panels[tab];
    if (!current) {
      const el = body.createDiv({ cls: 'qrs-center-panel', attr: { role: 'tabpanel' } });
      const panel = tab === 'library' ? new LibraryPanel(el, this.plugin, () => this.show('discover')) : new DiscoveryPanel(el, this.plugin);
      panel.load(); current = this.panels[tab] = { el, panel };
    }
    for (const [key, value] of Object.entries(this.panels)) value.el.toggleClass('qrs-hidden', key !== tab);
    current.panel.refresh(); current.panel.focusSearch();
  }
  refresh() {
    for (const value of Object.values(this.panels)) value.panel.refresh();
  }
  onClose() { for (const value of Object.values(this.panels)) value.panel.unload(); this.panels = {}; this.contentEl.empty(); }
}

// The former standalone pages. Saved workspaces may still restore them; they close themselves.
export const RETIRED_VIEW_TYPES = ['qiaomu-ai-rss-discovery', 'qiaomu-ai-rss-library'];
export class RetiredView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private type: string) { super(leaf); }
  getViewType() { return this.type; }
  getDisplayText() { return '订阅中心'; }
  onOpen() { window.setTimeout(() => this.leaf.detach(), 0); return Promise.resolve(); }
}
