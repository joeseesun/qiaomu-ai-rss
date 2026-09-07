import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { blogCatalogSource, blogTags, categories, DEFAULT_RSSHUB, discoveryFeeds, discoveryUrl, filterDiscovery, independentBlogs, rsshubFeeds, type DiscoveryCollection } from './discovery';
import { serviceUrl } from './model';

export const DISCOVERY_VIEW_TYPE = 'qiaomu-ai-rss-discovery';
export class DiscoveryView extends ItemView {
  private cards!: HTMLElement;
  private count!: HTMLElement;
  private query = '';
  private category = '全部';
  private collection: DiscoveryCollection = 'featured';
  private tag = '';
  private limit = 60;
  private more!: HTMLButtonElement;
  private pending = new Set<string>();
  private errors = new Map<string, string>();
  private closed = false;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) { super(leaf); }
  getViewType() { return DISCOVERY_VIEW_TYPE; }
  getDisplayText() { return '探索订阅'; }
  getIcon() { return 'compass'; }
  onOpen(): Promise<void> {
    this.closed = false; this.contentEl.empty(); this.contentEl.addClass('qrs-discovery');
    const page = this.contentEl.createDiv('qrs-discovery-page');
    const header = page.createDiv('qrs-discovery-header');
    const intro = header.createDiv();
    intro.createEl('h1', { text: '发现值得读的内容' });
    intro.createEl('p', { text: '从一个好订阅开始，把阅读留给自己。' });
    const actions = header.createDiv('qrs-discovery-actions');
    actions.createEl('button', { text: '管理订阅' }).onclick = () => this.plugin.manageSubscriptions();
    actions.createEl('button', { text: '开始阅读', cls: 'mod-cta' }).onclick = () => { void this.plugin.readSubscriptions(); };
    const collections = page.createDiv({ cls: 'qrs-discovery-collections' });
    const featured = collections.createEl('button', { text: `精选订阅 · ${discoveryFeeds.length}`, attr: { 'aria-pressed': String(this.collection === 'featured') } });
    const blogs = collections.createEl('button', { text: `独立博客 · ${independentBlogs.length}`, attr: { 'aria-pressed': String(this.collection === 'blogs') } });
    const rsshub = collections.createEl('button', { text: `RSSHub · ${rsshubFeeds.length}`, attr: { 'aria-pressed': String(this.collection === 'rsshub') } });
    const standard = page.createEl('p', { cls: 'qrs-discovery-standard', text: '精选标准：长期原创、持续更新、RSS 全文、个人辨识度。目前 9 个，宁缺毋滥。' });
    const attribution = page.createDiv('qrs-discovery-attribution');
    attribution.createSpan({ text: '目录来自 ' });
    attribution.createEl('a', { text: '中文独立博客列表', href: blogCatalogSource, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    attribution.createSpan({ text: '，由 Tim Qian 与社区维护（MIT）。收录不代表持续可用，添加时会验证。' });
    const fieldId = crypto.randomUUID(); page.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索订阅目录', attr: { for: `qrs-discovery-search-${fieldId}` } });
    const search = page.createEl('input', { type: 'search', cls: 'qrs-discovery-search', placeholder: '搜索名称、主题或语言…', attr: { id: `qrs-discovery-search-${fieldId}` } });
    search.value = this.query; search.oninput = () => { this.query = search.value; this.limit = 60; this.refresh(); };
    const filters = page.createDiv({ cls: 'qrs-discovery-filters' });
    for (const category of categories) {
      const button = filters.createEl('button', { text: category, attr: { 'aria-pressed': String(this.category === category) } });
      button.onclick = () => {
        this.category = category; this.limit = 60;
        for (const item of filters.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
        this.refresh();
      };
    }
    page.createEl('label', { cls: 'qrs-visually-hidden', text: '博客主题', attr: { for: `qrs-discovery-tags-${fieldId}` } });
    const tags = page.createEl('select', { cls: 'qrs-discovery-tags dropdown', attr: { id: `qrs-discovery-tags-${fieldId}` } });
    tags.createEl('option', { value: '', text: '全部主题' });
    for (const tag of blogTags) tags.createEl('option', { value: tag, text: tag });
    tags.value = this.tag; tags.onchange = () => { this.tag = tags.value; this.limit = 60; this.refresh(); };
    const provider = page.createDiv('qrs-discovery-provider');
    this.count = provider.createSpan({ cls: 'qrs-discovery-count', attr: { role: 'status' } });
    const details = page.createEl('details', { cls: 'qrs-discovery-instance' });
    const summary = details.createEl('summary', { text: `RSSHub 实例 · ${new URL(this.plugin.state.settings.rsshubUrl).hostname}` });
    details.createEl('p', { text: 'RSSHub 将网站内容转换成订阅。默认使用第三方公共实例，也可使用自己的 HTTPS 实例。仅影响以后添加的订阅。' });
    const form = details.createEl('form', { cls: 'qrs-discovery-instance-form' });
    form.createEl('label', { cls: 'qrs-visually-hidden', text: 'RSSHub 实例地址', attr: { for: `qrs-rsshub-${fieldId}` } });
    const instance = form.createEl('input', { type: 'url', value: this.plugin.state.settings.rsshubUrl, attr: { id: `qrs-rsshub-${fieldId}`, required: '' } });
    form.createEl('button', { text: '应用', type: 'submit' });
    const message = details.createDiv({ cls: 'qrs-subscription-message', attr: { role: 'status' } });
    form.onsubmit = event => {
      event.preventDefault();
      void (async () => {
        try {
          const url = serviceUrl(instance.value); this.plugin.state.settings.rsshubUrl = url;
          await this.plugin.persist(); instance.value = url; summary.setText(`RSSHub 实例 · ${new URL(url).hostname}`);
          message.setText('已保存，已有订阅地址保持不变。'); this.errors.clear(); this.plugin.refreshDiscovery();
        } catch { message.setText('请输入完整的 HTTPS 实例地址，不包含路径、账号或查询参数。'); }
      })();
    };
    const help = details.createEl('p');
    help.createSpan({ text: `默认实例：${DEFAULT_RSSHUB} · ` });
    help.createEl('a', { text: 'RSSHub 路由文档', href: 'https://docs.rsshub.app/', attr: { target: '_blank', rel: 'noopener noreferrer' } });
    this.cards = page.createDiv('qrs-discovery-grid');
    this.more = page.createEl('button', { text: '显示更多博客', cls: 'qrs-discovery-more' });
    this.more.onclick = () => { this.limit += 60; this.refresh(); };
    const switchCollection = (collection: DiscoveryCollection) => {
      this.collection = collection; this.limit = 60;
      featured.setAttribute('aria-pressed', String(collection === 'featured')); blogs.setAttribute('aria-pressed', String(collection === 'blogs')); rsshub.setAttribute('aria-pressed', String(collection === 'rsshub'));
      filters.toggleClass('qrs-hidden', collection !== 'featured'); details.toggleClass('qrs-hidden', collection !== 'rsshub'); standard.toggleClass('qrs-hidden', collection !== 'featured');
      for (const el of [tags, attribution]) el.toggleClass('qrs-hidden', collection !== 'blogs');
      search.placeholder = collection === 'blogs' ? '搜索博客、作者、网址或主题…' : collection === 'rsshub' ? '搜索 RSSHub 订阅…' : '搜索精选作者或主题…';
      this.refresh();
    };
    featured.onclick = () => switchCollection('featured'); blogs.onclick = () => switchCollection('blogs'); rsshub.onclick = () => switchCollection('rsshub'); switchCollection(this.collection);
    page.createEl('p', { cls: 'qrs-discovery-footnote', text: '目录保存在本地，点击订阅时才读取内容，并按主题分组。公共源可能限流或失效；失败时可以重试。' });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    return Promise.resolve();
  }
  onClose(): Promise<void> { this.closed = true; return Promise.resolve(); }
  refresh() {
    if (this.closed || !this.cards) return;
    // Preserve keyboard focus when a pending card finishes or another view updates.
    const active = this.contentEl.ownerDocument.activeElement;
    const focusedId = active instanceof HTMLElement && this.cards.contains(active) ? active.closest<HTMLElement>('[data-feed]')?.dataset.feed : undefined;
    this.cards.empty();
    const feeds = filterDiscovery(this.query, this.collection === 'featured' ? this.category : '全部', this.collection, this.tag);
    const total = this.collection === 'blogs' ? independentBlogs.length : this.collection === 'rsshub' ? rsshubFeeds.length : discoveryFeeds.length;
    this.count.setText(`${feeds.length} / ${total} 个订阅`);
    this.more.toggleClass('qrs-hidden', feeds.length <= this.limit);
    this.more.setText(`显示更多博客（还剩 ${Math.max(0, feeds.length - this.limit)} 个）`);
    if (!feeds.length) this.cards.createDiv({ cls: 'qrs-empty', text: '没有找到匹配内容，试试其他关键词或分类。' });
    for (const feed of feeds.slice(0, this.limit)) {
      const url = discoveryUrl(feed, this.plugin.state.settings.rsshubUrl);
      const subscribed = this.plugin.state.subscriptions.some(item => item.url === url);
      const card = this.cards.createEl('article', { cls: 'qrs-discovery-card', attr: { 'data-feed': feed.id, tabindex: '-1' } });
      const heading = card.createDiv('qrs-discovery-card-heading');
      setIcon(heading.createSpan('qrs-discovery-icon'), feed.icon);
      heading.createEl('h2', { text: feed.name });
      card.createDiv({ cls: 'qrs-discovery-meta', text: `${feed.category} · ${feed.language}${feed.route ? ' · RSSHub' : ''}` });
      card.createEl('p', { text: feed.description });
      const footer = card.createDiv('qrs-discovery-card-footer');
      footer.createEl('a', { text: feed.route ? 'RSSHub 订阅地址' : new URL(feed.site ?? url).hostname, href: feed.site ?? url, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      const button = footer.createEl('button', { text: subscribed ? '已订阅' : this.pending.has(feed.id) ? '添加中…' : this.errors.has(feed.id) ? '重试' : '订阅' });
      button.disabled = subscribed || this.pending.has(feed.id);
      button.onclick = () => {
        if (this.pending.has(feed.id)) return;
        this.pending.add(feed.id); this.errors.delete(feed.id); this.refresh();
        void this.plugin.subscriptions.add(url, feed.category, this.contentEl.ownerDocument).then(async subscription => {
          await this.plugin.activateSubscription(subscription.id);
          new Notice(`已订阅 ${feed.name}`);
        }).catch((error: unknown) => {
          this.errors.set(feed.id, error instanceof Error ? error.message : '添加失败，请重试。');
        }).finally(() => { this.pending.delete(feed.id); this.plugin.refreshDiscovery(); });
      };
      const error = this.errors.get(feed.id);
      if (error && !subscribed) card.createDiv({ cls: 'qrs-subscription-error', text: error, attr: { role: 'status' } });
    }
    if (focusedId) {
      const card = this.cards.querySelector<HTMLElement>(`[data-feed="${focusedId}"]`);
      (card?.querySelector<HTMLElement>('button:not(:disabled)') ?? card)?.focus({ preventScroll: true });
    }
  }
}
