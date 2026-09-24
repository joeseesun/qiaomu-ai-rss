import { Component, Menu, Notice, setIcon } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { exportOpml } from './feeds';
import { deleteGroup, ensureGroup, groupsInOrder, moveSources, personalSources, renameGroup, type PersonalSource } from './personal-library';
import { SourceIcons } from './source-icons';
import { addSearchClear } from './search-clear';
import { addLocalContent, ConfirmAction, GroupChoice, iconButton, OpmlImport, TextPrompt } from './subscription-ui';

type KindFilter = 'all' | PersonalSource['kind'] | 'error';
const kindLabels: Record<KindFilter, string> = { all: '全部', rss: 'RSS', podcast: '播客', vault: '本地文件', error: '读取失败' };

export function updatedLabel(ts: number, now = Date.now()) {
  if (!ts) return '尚未更新';
  const minutes = Math.floor((now - ts) / 60000);
  if (minutes < 1) return '刚刚更新';
  if (minutes < 60) return `${minutes} 分钟前更新`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前更新`;
  return `${Math.floor(minutes / 1440)} 天前更新`;
}

export class LibraryPanel extends Component {
  private icons: SourceIcons;
  private search!: HTMLInputElement;
  private kinds!: HTMLElement;
  private bulk!: HTMLElement;
  private list!: HTMLElement;
  private selected = new Set<string>();
  private query = '';
  private kind: KindFilter = 'all';
  private limit = 100;
  constructor(private contentEl: HTMLElement, private plugin: QiaomuRssPlugin, private discover: () => void = () => { void plugin.openDiscovery(); }) { super(); this.icons = new SourceIcons(plugin); }
  focusSearch() { this.search?.focus({ preventScroll: true }); }
  onload() {
    this.addChild(this.icons); this.contentEl.empty(); this.contentEl.addClass('qrs-discovery', 'qrs-library');
    const page = this.contentEl.createDiv('qrs-discovery-page');
    const tools = page.createDiv('qrs-library-tools'), id = crypto.randomUUID();
    tools.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索订阅或分组', attr: { for: id } });
    this.search = tools.createEl('input', { type: 'search', placeholder: '搜索订阅或分组…', attr: { id } }); addSearchClear(this.search);
    this.search.oninput = () => { this.query = this.search.value; this.limit = 100; this.render(); };
    // One toolbar row: search, type filter, and a single "add" entry point; library-level actions live in its menu.
    this.kinds = tools.createDiv({ cls: 'qrs-library-kinds', attr: { role: 'group', 'aria-label': '按类型筛选' } });
    const add = tools.createEl('button', { cls: 'mod-cta qrs-library-add', attr: { 'aria-haspopup': 'menu' } });
    setIcon(add.createSpan(), 'plus'); add.createSpan({ text: '添加' });
    add.onclick = () => this.addMenu(add);
    this.list = page.createDiv('qrs-library-list');
    this.bulk = page.createDiv({ cls: 'qrs-library-bulk', attr: { role: 'toolbar', 'aria-label': '批量操作' } });
    this.render();
  }
  private addMenu(anchor: HTMLElement) {
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem(i => i.setTitle('发现订阅').setIcon('compass').onClick(() => this.discover()));
    menu.addItem(i => i.setTitle('添加本地文件夹或笔记').setIcon('hard-drive').onClick(() => addLocalContent(this.plugin, anchor)));
    menu.addItem(i => i.setTitle('新建分组').setIcon('folder-plus').onClick(() => new TextPrompt(this.plugin, '新建分组', '', async name => { await this.plugin.editLibrary(() => { if (!name.trim()) throw new Error('名称不能为空。'); ensureGroup(this.plugin.state, name); }); }).open()));
    menu.addSeparator();
    menu.addItem(i => i.setTitle('导入 OPML').setIcon('download').onClick(() => new OpmlImport(this.plugin).open()));
    menu.addItem(i => i.setTitle('导出 OPML').setIcon('upload').onClick(() => this.exportOpml()));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: Math.max(8, rect.right - 220), y: rect.bottom + 4 });
  }
  refresh() { if (this.list) this.render(); }
  private exportOpml() {
    if (!this.plugin.state.subscriptions.length) { new Notice('还没有 RSS 订阅可导出。'); return; }
    void this.plugin.saveOpml(exportOpml(this.plugin.state.subscriptions)).then(() => new Notice('RSS 订阅已导出；本地文件和无 RSS 地址的播客保留在本库。')).catch(() => new Notice('导出失败，请重试。'));
  }
  private feed(id: string) { return this.plugin.state.subscriptions.find(f => f.id === id); }
  // The type prefix only earns its place when the list mixes types.
  private detail(item: PersonalSource) {
    const typed = this.kind === 'all' || this.kind === 'error';
    if (item.kind === 'podcast') return '播客';
    if (item.kind === 'vault') return typed ? `本地 · ${item.detail}` : item.detail;
    const feed = this.feed(item.id); if (!feed) return item.detail;
    return feed.error || `${typed ? 'RSS · ' : ''}${feed.entries.length} 篇`;
  }
  private status(parent: HTMLElement, item: PersonalSource, read: Set<string>) {
    const feed = this.feed(item.id); if (!feed) return;
    const status = parent.createDiv('qrs-library-status');
    if (feed.error) { const err = status.createSpan('qrs-library-error'); setIcon(err.createSpan(), 'alert-circle'); err.createSpan({ text: '读取失败' }); return; }
    status.createSpan({ text: updatedLabel(feed.updatedAt) });
    const unread = feed.entries.filter(e => !read.has(e.id)).length;
    if (unread) { const badge = status.createSpan({ cls: 'qrs-library-unread', text: String(unread) }); badge.createSpan({ cls: 'qrs-visually-hidden', text: ' 篇未读' }); }
  }
  private matchesKind(item: PersonalSource) {
    if (this.kind === 'all') return true;
    if (this.kind === 'error') return !!this.feed(item.id)?.error;
    return item.kind === this.kind;
  }
  private updated() { this.selected.clear(); this.render(); }
  private remove(ids: string[]) { new ConfirmAction(this.plugin, `取消 ${ids.length} 个订阅`, '保留已收藏的文章和笔记。本地文件及文件夹不会被删除。', async () => { await this.plugin.removePersonalSources(ids); this.updated(); }).open(); }
  private refreshFeeds(ids: string[]) {
    const feeds = ids.filter(id => this.feed(id)); if (!feeds.length) return;
    new Notice(`正在刷新 ${feeds.length} 个 RSS 订阅…`);
    void this.plugin.subscriptions.refresh(feeds, this.contentEl.ownerDocument, true).then(() => this.plugin.persist()).then(() => { this.plugin.refreshPersonalViews(); this.render(); });
  }
  private renderKinds(all: PersonalSource[]) {
    this.kinds.empty();
    const useful = new Set(all.map(item => item.kind)).size > 1 || all.some(item => !!this.feed(item.id)?.error);
    this.kinds.toggleClass('qrs-hidden', !useful); if (!useful) { this.kind = 'all'; return; }
    for (const kind of Object.keys(kindLabels) as KindFilter[]) {
      const count = kind === 'all' ? all.length : all.filter(item => kind === 'error' ? !!this.feed(item.id)?.error : item.kind === kind).length;
      if (kind !== 'all' && !count) { if (this.kind === kind) this.kind = 'all'; continue; }
      const button = this.kinds.createEl('button', { text: kindLabels[kind], attr: { 'aria-pressed': String(this.kind === kind), 'data-kind': kind } });
      button.createSpan({ cls: 'qrs-library-kind-count', text: String(count) });
      if (kind === 'error') button.addClass('qrs-library-error-filter');
      button.onclick = () => { this.kind = kind; this.limit = 100; this.render(); };
    }
  }
  private syncSelection() {
    for (const check of this.list.querySelectorAll<HTMLInputElement>('input[data-id]')) check.checked = this.selected.has(check.dataset.id!);
    for (const pick of this.list.querySelectorAll<HTMLInputElement>('input[data-ids]')) {
      const ids = pick.dataset.ids ? pick.dataset.ids.split('\n') : [];
      pick.checked = !!ids.length && ids.every(id => this.selected.has(id)); pick.indeterminate = !pick.checked && ids.some(id => this.selected.has(id));
    }
    this.renderBulk();
  }
  private renderBulk() {
    this.bulk.empty(); this.bulk.toggleClass('qrs-hidden', !this.selected.size); this.list.toggleClass('is-selecting', !!this.selected.size); if (!this.selected.size) return;
    this.bulk.createSpan({ text: `已选 ${this.selected.size} 项` });
    this.bulk.createEl('button', { text: '移动到分组' }).onclick = () => new GroupChoice(this.plugin, '移动到分组', '', async id => { await this.plugin.editLibrary(() => moveSources(this.plugin.state, [...this.selected], id)); this.updated(); }).open();
    if ([...this.selected].some(id => this.feed(id))) this.bulk.createEl('button', { text: '刷新' }).onclick = () => this.refreshFeeds([...this.selected]);
    this.bulk.createEl('button', { text: '取消订阅', cls: 'mod-warning' }).onclick = () => this.remove([...this.selected]);
    this.bulk.createEl('button', { text: '取消选择' }).onclick = () => { this.selected.clear(); this.syncSelection(); };
  }
  private groupMenu(id: string, anchor: HTMLElement) {
    const state = this.plugin.state, group = state.subscriptionGroups.find(g => g.id === id)!;
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem(i => i.setTitle('阅读此分组').setIcon('book-open').onClick(() => { void this.plugin.openPersonalSource(`@group:${id}`); }));
    menu.addItem(i => i.setTitle('重命名').setIcon('pencil').onClick(() => new TextPrompt(this.plugin, '重命名分组', group.name, async name => { await this.plugin.editLibrary(() => renameGroup(state, id, name)); this.updated(); }).open()));
    for (const [label, step] of [['上移', -1], ['下移', 1]] as const) {
      const groups = groupsInOrder(state), index = groups.findIndex(g => g.id === id), other = groups[index + step];
      menu.addItem(i => i.setTitle(label).setIcon(step < 0 ? 'arrow-up' : 'arrow-down').setDisabled(!other).onClick(async () => { if (other) { await this.plugin.editLibrary(() => { groups.forEach((g, n) => { g.order = n; }); [group.order, other.order] = [other.order, group.order]; }); this.updated(); } }));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle('删除分组').setIcon('trash-2').setWarning(true).onClick(() => new ConfirmAction(this.plugin, '删除分组', '组内所有订阅将移到未分组，订阅会保留。', async () => { await this.plugin.editLibrary(() => deleteGroup(state, id)); this.updated(); }).open()));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }
  private itemMenu(item: PersonalSource, anchor: HTMLElement) {
    const menu = new Menu().setUseNativeMenu(false), feed = this.feed(item.id);
    menu.addItem(i => i.setTitle('重命名').setIcon('pencil').onClick(() => new TextPrompt(this.plugin, '订阅名称', item.name, async name => { await this.plugin.editLibrary(() => { if (!name.trim()) throw new Error('名称不能为空。'); this.plugin.state.sourceMeta[item.id].name = name.trim().slice(0, 200); if (feed) feed.name = name.trim().slice(0, 200); }); this.updated(); }).open()));
    menu.addItem(i => i.setTitle('移动到分组').setIcon('folder').onClick(() => new GroupChoice(this.plugin, '移动到分组', item.groupId, async id => { await this.plugin.editLibrary(() => moveSources(this.plugin.state, [item.id], id)); this.updated(); }).open()));
    if (feed) {
      menu.addItem(i => i.setTitle('立即刷新').setIcon('refresh-cw').onClick(() => this.refreshFeeds([item.id])));
      menu.addItem(i => i.setTitle('复制订阅地址').setIcon('link').onClick(() => { void navigator.clipboard.writeText(feed.url).then(() => new Notice('已复制订阅地址。')); }));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle('取消订阅').setIcon('trash-2').setWarning(true).onClick(() => this.remove([item.id])));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }
  private render() {
    const state = this.plugin.state, all = personalSources(state), query = this.query.trim().toLocaleLowerCase();
    const valid = new Set(all.map(s => s.id)); for (const id of this.selected) if (!valid.has(id)) this.selected.delete(id);
    this.icons.clear(); this.list.empty(); this.renderKinds(all); this.renderBulk();
    const filtering = !!query || this.kind !== 'all', read = new Set(state.readIds); let shown = 0;
    for (const group of [...groupsInOrder(state), { id: '', name: '未分组', order: Infinity }]) {
      const items = all.filter(s => s.groupId === group.id && this.matchesKind(s) && `${s.name} ${s.detail} ${group.name}`.toLocaleLowerCase().includes(query));
      if (!items.length && (filtering || !group.id)) continue;
      const section = this.list.createEl('section', { cls: 'qrs-library-group' });
      const empty = !items.length, collapsed = empty || (!filtering && state.collapsedGroups.includes(group.id));
      const header = section.createDiv('qrs-group-header');
      header.toggleClass('is-empty', empty);
      const pick = header.createEl('input', { type: 'checkbox', attr: { 'aria-label': `选择 ${group.name} 全部订阅` } });
      pick.checked = !!items.length && items.every(i => this.selected.has(i.id)); pick.indeterminate = !pick.checked && items.some(i => this.selected.has(i.id)); pick.disabled = !items.length;
      pick.dataset.ids = items.map(i => i.id).join('\n');
      pick.onchange = () => { for (const i of items) { if (pick.checked) this.selected.add(i.id); else this.selected.delete(i.id); } this.syncSelection(); };
      const toggle = header.createEl('button', { cls: 'qrs-library-group-toggle', attr: { 'aria-expanded': String(!collapsed) } });
      setIcon(toggle.createSpan('qrs-library-chevron'), 'chevron-right'); toggle.createSpan({ text: group.name });
      if (empty) toggle.createSpan({ cls: 'qrs-library-empty-hint', text: '空分组 · 选择订阅后“移动到分组”' });
      else toggle.createSpan({ cls: 'qrs-library-count', text: String(items.length) });
      toggle.onclick = () => { if (filtering || empty) return; void this.plugin.editLibrary(() => { state.collapsedGroups = collapsed ? state.collapsedGroups.filter(id => id !== group.id) : [...state.collapsedGroups, group.id]; }).catch(() => new Notice('保存失败。')); };
      if (group.id) { const more = iconButton(header, 'ellipsis', `管理 ${group.name}`, () => this.groupMenu(group.id, more)); }
      if (collapsed) continue;
      for (const item of items) {
        if (shown++ >= this.limit) continue;
        const row = section.createDiv({ cls: 'qrs-subscription-row', attr: { 'data-source': item.id } });
        const check = row.createEl('input', { type: 'checkbox' }); check.checked = this.selected.has(item.id);
        const labelId = crypto.randomUUID(); check.setAttribute('aria-labelledby', labelId);
        check.dataset.id = item.id;
        check.onchange = () => { if (check.checked) this.selected.add(item.id); else this.selected.delete(item.id); this.syncSelection(); };
        this.icons.render(row, item);
        const info = row.createDiv('qrs-subscription-info');
        info.createEl('button', { cls: 'qrs-source-name', text: item.name, attr: { id: labelId, 'aria-label': `阅读 ${item.name}` } }).onclick = () => { void this.plugin.openPersonalSource(item.id); };
        info.createDiv({ cls: 'qrs-subscription-detail', text: this.detail(item) }).toggleClass('mod-error', !!this.feed(item.id)?.error);
        this.status(row, item, read);
        // Status rests on the right; on hover or focus the same spot turns into actions.
        const actions = row.createDiv('qrs-library-row-actions');
        if (this.feed(item.id)) iconButton(actions, 'refresh-cw', `刷新 ${item.name}`, () => this.refreshFeeds([item.id]));
        const more = iconButton(actions, 'ellipsis', `管理 ${item.name}`, () => this.itemMenu(item, more));
        row.onclick = e => { if (!this.selected.size || (e.target as HTMLElement).closest('button,input')) return; check.click(); };
      }
    }
    if (!all.length) {
      const empty = this.list.createDiv('qrs-empty'); empty.createEl('p', { text: '还没有订阅。' });
      empty.createEl('button', { text: '发现订阅', cls: 'mod-cta' }).onclick = () => this.discover();
      empty.createEl('button', { text: '导入 OPML' }).onclick = () => new OpmlImport(this.plugin).open();
    } else if (!shown && filtering) this.list.createDiv({ cls: 'qrs-empty', text: '没有匹配的订阅。' });
    if (shown > this.limit) this.list.createEl('button', { cls: 'qrs-discovery-more', text: `显示更多（${shown - this.limit}）` }).onclick = () => { this.limit += 100; this.render(); };
  }
}

