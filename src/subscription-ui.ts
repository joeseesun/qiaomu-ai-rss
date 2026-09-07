import { Modal, Notice, Setting, setIcon } from 'obsidian';
import { DiscoveryPanel } from './discovery-view';
import { VaultFilePicker, VaultFolderPicker, vaultSourceId } from './vault-source';
import type QiaomuRssPlugin from './main';
import { exportOpml, MAX_SUBSCRIPTIONS, parseOpml, type FeedInput } from './feeds';
import type { Subscription } from './model';

export type SubscriptionTab = 'mine' | 'explore' | 'local';
export class SubscriptionManager extends Modal {
  private list!: HTMLElement;
  private message!: HTMLElement;
  private discovery?: DiscoveryPanel;
  private body!: HTMLElement;
  constructor(private plugin: QiaomuRssPlugin, private changed: () => void, private tab: SubscriptionTab = 'mine') { super(plugin.app); }
  onOpen() {
    this.setTitle('订阅管理'); this.modalEl.addClass('qrs-subscription-modal');
    const tabs = this.contentEl.createDiv({ cls: 'qrs-subscription-tabs', attr: { role: 'tablist' } });
    this.body = this.contentEl.createDiv({ cls: 'qrs-subscription-body', attr: { role: 'tabpanel', id: `qrs-sources-${crypto.randomUUID()}` } });
    const choices: [SubscriptionTab, string][] = [['mine', '我的订阅'], ['explore', '探索'], ['local', '本地文件夹']];
    const select = (tab: SubscriptionTab) => {
      this.tab = tab;
      for (const button of tabs.querySelectorAll('button')) { const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
      this.discovery?.unload(); this.discovery = undefined; this.body.empty();
      if (tab === 'mine') this.renderMine();
      else if (tab === 'explore') { this.discovery = new DiscoveryPanel(this.body.createDiv(), this.plugin, true); this.discovery.load(); }
      else this.renderLocal();
    };
    for (const [tab, label] of choices) {
      const button = tabs.createEl('button', { text: label, attr: { role: 'tab', 'data-tab': tab, 'aria-controls': this.body.id } });
      button.onclick = () => select(tab);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const index = choices.findIndex(([id]) => id === this.tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        select(choices[next][0]); (tabs.children[next] as HTMLButtonElement).focus();
      };
    }
    select(this.tab);
  }
  onClose() { this.discovery?.unload(); this.contentEl.empty(); }
  refresh() { this.discovery?.refresh(); }
  private renderLocal() {
    const add = (path: string) => {
      const settings = this.plugin.state.settings;
      if (!settings.markdownFolders.includes(path)) settings.markdownFolders.push(path);
      settings.lastSource = vaultSourceId(path);
      void this.plugin.persist().then(() => { this.plugin.resetViews(); if (this.tab === 'local' && this.body.isConnected) { this.body.empty(); this.renderLocal(); } });
    };
    const tools = this.body.createDiv('qrs-subscription-tools');
    tools.createEl('button', { text: '添加文件夹' }).onclick = () => new VaultFolderPicker(this.app, folder => add(folder.path)).open();
    tools.createEl('button', { text: '添加文件' }).onclick = () => new VaultFilePicker(this.app, file => add(file.path)).open();
    for (const path of this.plugin.state.settings.markdownFolders) {
      new Setting(this.body).setName(path === '/' ? '整个库' : path).addButton(button => button.setButtonText('移除').onClick(async () => {
        this.plugin.state.settings.markdownFolders = this.plugin.state.settings.markdownFolders.filter(value => value !== path);
        await this.plugin.persist(); this.plugin.resetViews(); if (this.tab === 'local' && this.body.isConnected) { this.body.empty(); this.renderLocal(); }
      }));
    }
    if (!this.plugin.state.settings.markdownFolders.length) this.body.createEl('p', { cls: 'qrs-subscription-help', text: '选择剪藏文件夹或笔记，在阅读器中阅读。' });
  }
  private renderMine() {
    const form = this.body.createEl('form', { cls: 'qrs-subscription-add' });
    const fieldId = crypto.randomUUID();
    form.createEl('label', { cls: 'qrs-visually-hidden', text: 'RSS 或 Atom 地址', attr: { for: `qrs-feed-${fieldId}` } });
    const url = form.createEl('input', { type: 'url', placeholder: 'https://example.com/feed.xml', attr: { id: `qrs-feed-${fieldId}`, required: '' } });
    form.createEl('label', { cls: 'qrs-visually-hidden', text: '订阅分组', attr: { for: `qrs-group-${fieldId}` } });
    const group = form.createEl('input', { type: 'text', placeholder: '分组（可选）', attr: { id: `qrs-group-${fieldId}`, maxlength: '100' } });
    const add = form.createEl('button', { text: '添加', type: 'submit', cls: 'mod-cta' });
    this.message = this.body.createDiv({ cls: 'qrs-subscription-message', attr: { role: 'status' } });
    form.onsubmit = event => {
      event.preventDefault(); add.disabled = true; this.message.setText('正在读取订阅源…');
      void this.plugin.subscriptions.add(url.value, group.value, this.contentEl.ownerDocument).then(() => {
        url.value = ''; this.message.setText('订阅已添加。'); this.renderList(); this.changed();
      }).catch((error: unknown) => { this.message.setText(error instanceof Error ? error.message : '添加失败，请重试。'); }).finally(() => { add.disabled = false; });
    };
    const tools = this.body.createDiv('qrs-subscription-tools');
    const importButton = tools.createEl('button', { text: '导入 OPML' });
    importButton.onclick = () => new OpmlImport(this.plugin, () => { this.renderList(); this.changed(); }).open();
    const exportButton = tools.createEl('button', { text: '导出 OPML' });
    exportButton.onclick = () => {
      if (!this.plugin.state.subscriptions.length) { this.message.setText('还没有可以导出的订阅。'); return; }
      void this.plugin.saveOpml(exportOpml(this.plugin.state.subscriptions)).then(path => {
        this.message.setText(`已导出到 ${path}`);
      }).catch(() => { this.message.setText('导出失败，请检查 OPML 导出文件夹。'); });
    };
    this.list = this.body.createDiv('qrs-subscription-list'); this.renderList();
    this.body.createEl('p', { cls: 'qrs-subscription-help', text: '订阅仅保存在本库。直接读取订阅网站；个人源显示原文，不调用 AI。' });
  }
  private renderList() {
    this.list.empty();
    const feeds = [...this.plugin.state.subscriptions].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    if (!feeds.length) { this.list.createDiv({ cls: 'qrs-empty', text: '添加第一个订阅，开始阅读。' }); return; }
    for (const feed of feeds) {
      const row = this.list.createDiv('qrs-subscription-row');
      const info = row.createDiv('qrs-subscription-info');
      info.createDiv({ cls: 'qrs-subscription-name', text: feed.name });
      info.createDiv({ cls: 'qrs-subscription-detail', text: `${feed.group || '未分组'} · ${new URL(feed.url).hostname} · ${feed.entries.length} 篇` });
      if (feed.error) info.createDiv({ cls: 'qrs-subscription-error', text: feed.error });
      const edit = row.createEl('button', { cls: 'qrs-subscription-icon', attr: { 'data-qrs-label': `编辑 ${feed.name}` } });
      setIcon(edit, 'pencil'); edit.createSpan({ cls: 'qrs-visually-hidden', text: `编辑 ${feed.name}` });
      edit.onclick = () => new EditSubscription(this.plugin, feed, () => { this.renderList(); this.changed(); }).open();
      const remove = row.createEl('button', { cls: 'qrs-subscription-icon', attr: { 'data-qrs-label': `取消订阅 ${feed.name}` } });
      setIcon(remove, 'trash-2'); remove.createSpan({ cls: 'qrs-visually-hidden', text: `取消订阅 ${feed.name}` });
      remove.onclick = () => new RemoveSubscription(this.plugin, feed, () => { this.renderList(); this.changed(); }).open();
    }
  }
}
class EditSubscription extends Modal {
  constructor(private plugin: QiaomuRssPlugin, private feed: Subscription, private changed: () => void) { super(plugin.app); }
  onOpen() {
    this.setTitle('编辑订阅'); this.modalEl.addClass('qrs-subscription-modal'); let name = this.feed.name; let group = this.feed.group;
    new Setting(this.contentEl).setName('名称').addText(text => text.setValue(name).onChange(value => { name = value; }));
    new Setting(this.contentEl).setName('分组').addText(text => text.setValue(group).setPlaceholder('未分组').onChange(value => { group = value; }));
    new Setting(this.contentEl).addButton(button => button.setButtonText('保存').setCta().onClick(async () => {
      try { await this.plugin.subscriptions.edit(this.feed.id, name, group); this.changed(); this.close(); }
      catch (error) { new Notice(error instanceof Error ? error.message : '保存失败。'); }
    }));
  }
}
class RemoveSubscription extends Modal {
  constructor(private plugin: QiaomuRssPlugin, private feed: Subscription, private changed: () => void) { super(plugin.app); }
  onOpen() {
    this.setTitle(`取消订阅 ${this.feed.name}`);
    this.contentEl.createEl('p', { text: '移除这个源及其文章列表，已收藏的文章和已保存的笔记会保留。' });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('保留订阅').onClick(() => this.close()))
      .addButton(button => button.setButtonText('取消订阅').setDestructive().onClick(async () => {
        await this.plugin.subscriptions.remove(this.feed.id); this.changed(); this.close();
      }));
  }
}
class OpmlImport extends Modal {
  private feeds: FeedInput[] = [];
  constructor(private plugin: QiaomuRssPlugin, private changed: () => void) { super(plugin.app); }
  onOpen() {
    this.setTitle('导入 OPML'); this.modalEl.addClass('qrs-subscription-modal');
    const fieldId = crypto.randomUUID();
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: '选择 OPML 文件', attr: { for: `qrs-opml-file-${fieldId}` } });
    const input = this.contentEl.createEl('input', { type: 'file', attr: { id: `qrs-opml-file-${fieldId}`, accept: '.opml,.xml,text/xml,application/xml' } });
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: 'OPML 内容', attr: { for: `qrs-opml-text-${fieldId}` } });
    const area = this.contentEl.createEl('textarea', { cls: 'qrs-opml-text', placeholder: '也可以粘贴 OPML 内容…', attr: { id: `qrs-opml-text-${fieldId}` } });
    const preview = this.contentEl.createDiv({ cls: 'qrs-opml-preview', attr: { role: 'status' } });
    const importButton = this.contentEl.createEl('button', { text: '导入订阅', cls: 'mod-cta' }); importButton.disabled = true;
    const validate = () => {
      this.feeds = []; importButton.disabled = true; preview.empty();
      try {
        const parsed = parseOpml(area.value, this.contentEl.ownerDocument);
        const existing = new Set(this.plugin.state.subscriptions.map(feed => feed.url));
        this.feeds = parsed.feeds.filter(feed => !existing.has(feed.url));
        preview.createEl('p', { text: `新增 ${this.feeds.length} 个订阅，跳过 ${parsed.skipped + parsed.feeds.length - this.feeds.length} 个重复或无效地址。` });
        if (this.feeds.length + existing.size > MAX_SUBSCRIPTIONS) throw new Error(`最多保留 ${MAX_SUBSCRIPTIONS} 个订阅，请减少导入数量。`);
        for (const feed of this.feeds.slice(0, 10)) preview.createDiv({ text: `${feed.group ? feed.group + ' / ' : ''}${feed.name}` });
        if (this.feeds.length > 10) preview.createDiv({ text: `另有 ${this.feeds.length - 10} 个订阅` });
        importButton.disabled = !this.feeds.length;
      } catch (error) { preview.setText(error instanceof Error ? error.message : '文件无法读取。'); }
    };
    area.oninput = validate;
    input.onchange = () => {
      this.feeds = []; importButton.disabled = true;
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) { preview.setText('OPML 文件超过 5 MB。'); return; }
      void file.text().then(value => { area.value = value; validate(); }).catch(() => { preview.setText('文件无法读取。'); });
    };
    this.contentEl.createEl('p', { cls: 'qrs-subscription-help', text: '导入后在“我的订阅”点击刷新获取文章。导入不会覆盖现有订阅的名称和分组。' });
    importButton.onclick = () => {
      importButton.disabled = true;
      void this.plugin.subscriptions.import(this.feeds).then(count => {
        new Notice(`已导入 ${count} 个订阅。`); this.changed(); this.close();
      }).catch((error: unknown) => { preview.setText(error instanceof Error ? error.message : '导入失败。'); importButton.disabled = false; });
    };
  }
}
