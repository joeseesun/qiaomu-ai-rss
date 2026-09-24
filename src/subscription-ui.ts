import { Menu, Modal, Notice, Setting, setIcon } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { MAX_SUBSCRIPTIONS, parseOpml, type FeedInput } from './feeds';
import { ensureGroup, groupsInOrder } from './personal-library';
import { readImportUrl } from './import-source';
import { VaultFilePicker, VaultFolderPicker } from './vault-source';

export function iconButton(parent: HTMLElement, icon: string, label: string, action: () => void) {
  const button = parent.createEl('button', { cls: 'qrs-subscription-icon', attr: { 'data-qrs-label': label } });
  setIcon(button, icon); button.createSpan({ cls: 'qrs-visually-hidden', text: label }); button.onclick = action; return button;
}
export class TextPrompt extends Modal {
  constructor(plugin: QiaomuRssPlugin, private title: string, private value: string, private save: (value: string) => Promise<void>) { super(plugin.app); }
  onOpen() {
    this.modalEl.addClass('qrs-modal'); this.setTitle(this.title); let value = this.value;
    const input = new Setting(this.contentEl).setName('名称').addText(text => text.setValue(value).onChange(v => { value = v; }));
    const submit = async () => { try { await this.save(value); this.close(); } catch (e) { new Notice(e instanceof Error ? e.message : '保存失败。'); } };
    input.controlEl.querySelector('input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) void submit(); });
    new Setting(this.contentEl).addButton(b => b.setButtonText('保存').setCta().onClick(submit));
  }
}
export function groupSelect(parent: HTMLElement, plugin: QiaomuRssPlugin, initial: string, changed: (id: string) => void) {
  const row = parent.createDiv('qrs-group-choice'), id = crypto.randomUUID();
  row.createEl('label', { text: '分组', attr: { for: id } });
  const select = row.createEl('select', { attr: { id } });
  const populate = (value: string) => { select.empty(); select.createEl('option', { value: '', text: '未分组' }); for (const g of groupsInOrder(plugin.state)) select.createEl('option', { value: g.id, text: g.name }); select.value = value; };
  populate(initial); select.onchange = () => changed(select.value);
  row.createEl('button', { text: '新建分组' }).onclick = () => new TextPrompt(plugin, '新建分组', '', async name => {
    let id = ''; await plugin.editLibrary(() => { if (!name.trim()) throw new Error('分组名称不能为空。'); id = ensureGroup(plugin.state, name); }); populate(id); changed(id);
  }).open();
  return select;
}
export function addLocalContent(plugin: QiaomuRssPlugin, button: HTMLElement) {
  const choose = (path: string) => new GroupChoice(plugin, '添加本地内容', '', async id => { await plugin.addLocalSource(path, id); new Notice('已加入我的订阅。'); }).open();
  const menu = new Menu().setUseNativeMenu(false); menu.addItem(i => i.setTitle('添加文件夹').setIcon('folder-open').onClick(() => new VaultFolderPicker(plugin.app, f => choose(f.path)).open()));
  menu.addItem(i => i.setTitle('添加笔记').setIcon('file-text').onClick(() => new VaultFilePicker(plugin.app, f => choose(f.path)).open()));
  const rect = button.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
}
export class GroupChoice extends Modal {
  constructor(private plugin: QiaomuRssPlugin, private title: string, private groupId: string, private save: (id: string) => Promise<void>) { super(plugin.app); }
  onOpen() {
    this.modalEl.addClass('qrs-modal'); this.setTitle(this.title); groupSelect(this.contentEl, this.plugin, this.groupId, id => { this.groupId = id; });
    new Setting(this.contentEl).addButton(b => b.setButtonText('确定').setCta().onClick(async () => { b.setDisabled(true); try { await this.save(this.groupId); this.close(); } catch (e) { new Notice(e instanceof Error ? e.message : '保存失败。'); b.setDisabled(false); } }));
  }
}
export class ConfirmAction extends Modal {
  constructor(plugin: QiaomuRssPlugin, private title: string, private description: string, private action: () => Promise<void>) { super(plugin.app); }
  onOpen() { this.modalEl.addClass('qrs-modal'); this.setTitle(this.title); this.contentEl.createEl('p', { text: this.description }); new Setting(this.contentEl).addButton(b => b.setButtonText('取消').onClick(() => this.close())).addButton(b => b.setButtonText('确定').setDestructive().onClick(async () => { b.setDisabled(true); try { await this.action(); this.close(); } catch { new Notice('保存失败，请重试。'); b.setDisabled(false); } })); }
}
export class OpmlImport extends Modal {
  private serial = 0;
  constructor(private plugin: QiaomuRssPlugin, private changed: () => void = () => plugin.refreshDiscovery(), private initial = '') { super(plugin.app); }
  onClose() { this.serial++; this.contentEl.empty(); }
  onOpen() {
    this.setTitle('导入 OPML'); this.modalEl.addClass('qrs-subscription-modal', 'qrs-modal');
    const field = (label: string, type: string, placeholder = '') => { const id = crypto.randomUUID(); this.contentEl.createEl('label', { text: label, attr: { for: id } }); return this.contentEl.createEl('input', { type, placeholder, attr: { id } }); };
    const file = field('选择文件', 'file'); file.accept = '.opml,.xml';
    const url = field('在线地址', 'url', 'https://…/subscriptions.opml');
    const fetch = this.contentEl.createEl('button', { text: '读取链接' });
    const details = this.contentEl.createEl('details'); details.createEl('summary', { text: '粘贴 OPML 内容' });
    const area = details.createEl('textarea', { cls: 'qrs-opml-text', attr: { 'aria-labelledby': this.titleEl.id || (this.titleEl.id = crypto.randomUUID()) } });
    const status = this.contentEl.createDiv({ attr: { role: 'status' } });
    const query = field('筛选导入内容', 'search', '搜索名称或分组…');
    const actions = this.contentEl.createDiv('qrs-subscription-tools');
    const selectAll = actions.createEl('button', { text: '选择筛选结果' }), none = actions.createEl('button', { text: '清空选择' });
    const list = this.contentEl.createDiv('qrs-opml-selection');
    const submit = this.contentEl.createEl('button', { text: '导入', cls: 'mod-cta' }); submit.disabled = true;
    let feeds: FeedInput[] = [], selected = new Set<string>(), limit = 60, busy = false;
    const filtered = () => feeds.filter(f => `${f.name} ${f.group} ${f.url}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()));
    const updateSubmit = () => { submit.setText(`导入 ${selected.size} 个订阅`); submit.disabled = busy || !selected.size || selected.size + this.plugin.state.subscriptions.length > MAX_SUBSCRIPTIONS; };
    const render = () => { list.empty(); const values = filtered(); for (const feed of values.slice(0, limit)) { const row = list.createEl('label', { cls: 'qrs-opml-row' }); const check = row.createEl('input', { type: 'checkbox' }); check.checked = selected.has(feed.url); check.disabled = busy; row.createSpan({ text: `${feed.group || '未分组'} / ${feed.name}` }); check.onchange = () => { if (check.checked) selected.add(feed.url); else selected.delete(feed.url); updateSubmit(); }; } if (values.length > limit) list.createEl('button', { text: '显示更多' }).onclick = () => { limit += 60; render(); }; updateSubmit(); };
    const validate = (xml: string) => {
      feeds = []; selected.clear(); limit = 60;
      try { const parsed = parseOpml(xml, this.contentEl.ownerDocument), existing = new Set(this.plugin.state.subscriptions.map(f => f.url)); feeds = parsed.feeds.filter(f => !existing.has(f.url));
        selected = new Set(feeds.map(f => f.url)); status.setText(`新增 ${feeds.length} 个，跳过 ${parsed.skipped + parsed.feeds.length - feeds.length} 个重复或无效地址。${feeds.length + existing.size > MAX_SUBSCRIPTIONS ? '超过容量，请减少选择。' : ''}`);
      } catch (e) { status.setText(e instanceof Error ? e.message : '文件无法解析。'); } render();
    };
    query.oninput = () => { limit = 60; render(); }; selectAll.onclick = () => { for (const f of filtered()) selected.add(f.url); render(); }; none.onclick = () => { selected.clear(); render(); };
    area.oninput = () => { this.serial++; validate(area.value); };
    file.onchange = () => { const value = file.files?.[0], serial = ++this.serial; feeds = []; selected.clear(); render(); if (!value) return; if (value.size > 5 * 1024 * 1024) { status.setText('文件过大，请选择较小的 OPML 文件（上限 5 MB）。'); return; } void value.text().then(xml => { if (serial === this.serial) validate(xml); }).catch(() => { if (serial === this.serial) status.setText('读取文件失败。'); }); };
    url.oninput = () => { this.serial++; feeds = []; selected.clear(); render(); };
    fetch.onclick = () => { const serial = ++this.serial; status.setText('正在读取…'); feeds = []; selected.clear(); render(); void readImportUrl(url.value).then(result => { if (serial === this.serial) validate(result.text); }).catch(e => { if (serial === this.serial) status.setText(e instanceof Error ? e.message : '读取失败。'); }); };
    submit.onclick = () => { const chosen = feeds.filter(f => selected.has(f.url)); busy = true; for (const el of [file, url, fetch, area, selectAll, none]) el.disabled = true; render(); void this.plugin.subscriptions.import(chosen).then(count => { new Notice(`已导入 ${count} 个订阅，刷新时分批读取文章。`); this.changed(); this.close(); }).catch(() => { status.setText('保存失败，请重试。'); }).finally(() => { busy = false; for (const el of [file, url, fetch, area, selectAll, none]) el.disabled = false; updateSubmit(); }); };
    if (this.initial) { if (/^https?:/i.test(this.initial)) { url.value = this.initial; fetch.click(); } else validate(this.initial); }
  }
}
