import { Notice, Plugin, PluginSettingTab, TFile, type App, type SettingDefinitionItem } from 'obsidian';
import { requestUrl } from 'obsidian';
import { RssApi } from './api';
import { folderPath, initialState, modeLabels, modeSchema, noteName, serviceUrl, withServiceOrigin, type Bundle, type Mode, type State } from './model';
import { noteMarkdown } from './content';
import { ReaderView, VIEW_TYPE } from './view';
import { LocalImages } from './images';
import { Subscriptions } from './subscriptions';
import { SubscriptionManager } from './subscription-ui';
import { DiscoveryView, DISCOVERY_VIEW_TYPE } from './discovery-view';

export default class QiaomuRssPlugin extends Plugin {
  state: State = initialState(null);
  images!: LocalImages;
  subscriptions!: Subscriptions;
  private saving: Promise<void> = Promise.resolve();
  private exports = new Map<string, Promise<TFile>>();
  async onload() {
    const data: unknown = await this.loadData();
    try { this.state = initialState(data); }
    catch { new Notice('RSS 配置不兼容，已使用默认设置。'); }
    this.images = new LocalImages(this.app.vault, `${this.app.vault.configDir}/plugins/${this.manifest.id}/image-cache`);
    this.subscriptions = new Subscriptions(() => this.state, () => this.persist());
    this.addCommand({ id: 'manage-subscriptions', name: '管理我的订阅', callback: () => this.manageSubscriptions() });
    this.registerView(VIEW_TYPE, leaf => new ReaderView(leaf, this));
    this.registerView(DISCOVERY_VIEW_TYPE, leaf => new DiscoveryView(leaf, this));
    this.addCommand({ id: 'explore-subscriptions', name: '探索订阅', callback: () => { void this.openDiscovery(); } });
    this.addRibbonIcon('rss', '打开 RSS 阅读器', () => { void this.openReader(); });
    this.addCommand({ id: 'open-reader', name: '打开阅读器', callback: () => { void this.openReader(); } });
    this.addSettingTab(new RssSettings(this.app, this));
  }
  api(): RssApi {
    return new RssApi(this.state.settings.baseUrl, async url => {
      const response = await requestUrl({ url, method: 'GET', headers: { Accept: 'application/json' }, throw: false });
      return { status: response.status, text: response.text };
    });
  }
  async openReader() {
    try {
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
      await this.app.workspace.revealLeaf(leaf);
    } catch { new Notice('无法打开 RSS 阅读器。'); }
  }
  persist(): Promise<void> {
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData(this.state));
    return this.saving;
  }
  remember(bundle: Bundle) {
    this.state.cache[bundle.entry.id] = bundle;
    const recent = Object.values(this.state.cache).sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 40);
    this.state.cache = Object.fromEntries(recent.map(value => [value.entry.id, value]));
    if (this.state.favorites[bundle.entry.id]) this.state.favorites[bundle.entry.id] = bundle;
  }
  async saveArticle(bundle: Bundle, mode: Mode, doc: Document): Promise<TFile> {
    const folder = folderPath(this.state.settings.folder);
    const path = `${folder}/${noteName(bundle.entry, mode)}`;
    const pending = this.exports.get(path);
    if (pending) return pending;
    const write = async () => {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      const markdown = noteMarkdown(bundle, mode, doc, this.state.settings.remoteImages);
      let current = '';
      for (const segment of folder.split('/')) {
        current = current ? `${current}/${segment}` : segment;
        if (!this.app.vault.getAbstractFileByPath(current)) {
          try { await this.app.vault.createFolder(current); }
          catch (error) { if (!this.app.vault.getAbstractFileByPath(current)) throw error; }
        }
      }
      return this.app.vault.create(path, markdown);
    };
    const promise = write(); this.exports.set(path, promise);
    try { return await promise; } finally { this.exports.delete(path); }
  }
  manageSubscriptions() {
    new SubscriptionManager(this, () => {
      this.refreshDiscovery();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof ReaderView) leaf.view.showSubscriptions();
      }
    }).open();
  }
  async openDiscovery() {
    try {
      let leaf = this.app.workspace.getLeavesOfType(DISCOVERY_VIEW_TYPE)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: DISCOVERY_VIEW_TYPE, active: true }); }
      await this.app.workspace.revealLeaf(leaf);
    } catch { new Notice('无法打开订阅目录。'); }
  }
  refreshDiscovery() {
    for (const leaf of this.app.workspace.getLeavesOfType(DISCOVERY_VIEW_TYPE)) {
      if (leaf.view instanceof DiscoveryView) leaf.view.refresh();
    }
  }
  async activateSubscription(id: string) {
    if (!this.state.subscriptions.some(feed => feed.id === id)) return;
    this.state.settings.lastSource = id; await this.persist();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.showSubscription(id);
    }
  }
  async readSubscriptions() {
    await this.openReader();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof ReaderView) view.showSubscriptions();
  }
  async saveOpml(content: string): Promise<string> {
    const folder = folderPath(this.state.settings.folder); let current = '';
    for (const segment of folder.split('/')) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); }
        catch (error) { if (!this.app.vault.getAbstractFileByPath(current)) throw error; }
      }
    }
    const path = `${folder}/subscriptions-${Date.now()}.opml`;
    await this.app.vault.create(path, content); return path;
  }
  resetViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof ReaderView) leaf.view.reset();
    }
  }
}
class RssSettings extends PluginSettingTab {
  constructor(app: App, private plugin: QiaomuRssPlugin) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.state.settings;
    return [
      { name: '我的订阅', desc: '添加 RSS / Atom、分组与 OPML 导入导出。', render: setting => {
        setting.addButton(button => button.setButtonText('管理订阅').onClick(() => this.plugin.manageSubscriptions()));
      } },
      { name: '服务地址', desc: '连接兼容的 HTTPS 服务。切换地址会清空乔木精选的缓存与收藏，保留个人订阅。', render: setting => {
        setting.addText(text => text.setValue(settings.baseUrl).onChange(value => { this.pendingUrl = value; }))
          .addButton(button => button.setButtonText('应用').onClick(async () => {
            try {
              const base = serviceUrl(this.pendingUrl ?? settings.baseUrl);
              if (base !== settings.baseUrl) {
                this.plugin.state = withServiceOrigin(this.plugin.state, base);
                await this.plugin.persist(); this.plugin.resetViews(); this.update();
              }
            } catch (error) { new Notice(error instanceof Error ? error.message : '无法保存设置。'); }
          }));
      } },
      { name: '笔记文件夹', desc: '库内保存位置。重复保存会打开已有笔记，不覆盖编辑。', render: setting => {
        setting.addText(text => text.setValue(settings.folder).onChange(value => { this.pendingFolder = value; }))
          .addButton(button => button.setButtonText('保存').onClick(async () => {
            try { settings.folder = folderPath(this.pendingFolder ?? settings.folder); await this.plugin.persist(); new Notice('文件夹已保存。'); }
            catch (error) { new Notice(error instanceof Error ? error.message : '无法保存设置。'); }
          }));
      } },
      { name: '默认阅读版本', render: setting => {
        setting.addDropdown(drop => {
          for (const [value, label] of Object.entries(modeLabels)) drop.addOption(value, label);
          drop.setValue(settings.defaultMode).onChange(async value => {
            settings.defaultMode = modeSchema.parse(value); await this.plugin.persist();
          });
        });
      } },
      { name: '显示文章图片', desc: '图片下载到本库插件缓存后显示（最多 64 MB），再次阅读优先使用本地文件。导出笔记保留原图片链接。', render: setting => {
        setting.addToggle(toggle => toggle.setValue(settings.remoteImages).onChange(async value => {
          settings.remoteImages = value; await this.plugin.persist(); this.plugin.resetViews();
        }));
      } },
      { name: '本地数据', desc: '已读、收藏与缓存保存在当前库。浏览频道、切换文章或刷新时请求服务，不会上传你的笔记。' },
    ];
  }
  private pendingUrl?: string;
  private pendingFolder?: string;
}
