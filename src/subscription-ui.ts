import { Menu, Modal, Notice, Setting, setIcon } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { ensureGroup, groupsInOrder } from './personal-library';
import { VaultFilePicker, VaultFolderPicker } from './vault-source';
import { fail, t } from './i18n';

export function iconButton(parent: HTMLElement, icon: string, label: string, action: () => void) {
  const button = parent.createEl('button', { cls: 'qrs-subscription-icon', attr: { 'data-qrs-label': label } });
  setIcon(button, icon); button.createSpan({ cls: 'qrs-visually-hidden', text: label }); button.onclick = action; return button;
}
export class TextPrompt extends Modal {
  constructor(plugin: QiaomuRssPlugin, private title: string, private value: string, private save: (value: string) => Promise<void>) { super(plugin.app); }
  onOpen() {
    this.modalEl.addClass('qrs-modal'); this.setTitle(this.title); let value = this.value;
    const input = new Setting(this.contentEl).setName(t('modal.name')).addText(text => text.setValue(value).onChange(v => { value = v; }));
    const submit = async () => { try { await this.save(value); this.close(); } catch (e) { new Notice(e instanceof Error ? e.message : t('common.saveFailed')); } };
    input.controlEl.querySelector('input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) void submit(); });
    new Setting(this.contentEl).addButton(b => b.setButtonText(t('common.save')).setCta().onClick(submit));
  }
}
export function groupSelect(parent: HTMLElement, plugin: QiaomuRssPlugin, initial: string, changed: (id: string) => void) {
  const row = parent.createDiv('qrs-group-choice'), id = crypto.randomUUID();
  row.createEl('label', { text: t('modal.group'), attr: { for: id } });
  const select = row.createEl('select', { attr: { id } });
  const populate = (value: string) => { select.empty(); select.createEl('option', { value: '', text: t('common.ungrouped') }); for (const g of groupsInOrder(plugin.state)) select.createEl('option', { value: g.id, text: g.name }); select.value = value; };
  populate(initial); select.onchange = () => changed(select.value);
  row.createEl('button', { text: t('modal.newGroup') }).onclick = () => new TextPrompt(plugin, t('modal.newGroup'), '', async name => {
    let id = ''; await plugin.editLibrary(() => { if (!name.trim()) fail('error.groupNameEmpty'); id = ensureGroup(plugin.state, name); }); populate(id); changed(id);
  }).open();
  return select;
}
export function addLocalContent(plugin: QiaomuRssPlugin, button: HTMLElement) {
  const choose = (path: string) => new GroupChoice(plugin, t('modal.addLocalContent'), '', async id => { await plugin.addLocalSource(path, id); new Notice(t('notice.subscribed')); }).open();
  const menu = new Menu().setUseNativeMenu(false); menu.addItem(i => i.setTitle(t('modal.addFolder')).setIcon('folder-open').onClick(() => new VaultFolderPicker(plugin.app, f => choose(f.path)).open()));
  menu.addItem(i => i.setTitle(t('modal.addNote')).setIcon('file-text').onClick(() => new VaultFilePicker(plugin.app, f => choose(f.path)).open()));
  const rect = button.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
}
export class GroupChoice extends Modal {
  constructor(private plugin: QiaomuRssPlugin, private title: string, private groupId: string, private save: (id: string) => Promise<void>) { super(plugin.app); }
  onOpen() {
    this.modalEl.addClass('qrs-modal'); this.setTitle(this.title); groupSelect(this.contentEl, this.plugin, this.groupId, id => { this.groupId = id; });
    new Setting(this.contentEl).addButton(b => b.setButtonText(t('common.confirm')).setCta().onClick(async () => { b.setDisabled(true); try { await this.save(this.groupId); this.close(); } catch (e) { new Notice(e instanceof Error ? e.message : t('common.saveFailed')); b.setDisabled(false); } }));
  }
}
export class ConfirmAction extends Modal {
  constructor(plugin: QiaomuRssPlugin, private title: string, private description: string, private action: () => Promise<void>) { super(plugin.app); }
  onOpen() { this.modalEl.addClass('qrs-modal'); this.setTitle(this.title); this.contentEl.createEl('p', { text: this.description }); new Setting(this.contentEl).addButton(b => b.setButtonText(t('common.cancel')).onClick(() => this.close())).addButton(b => b.setButtonText(t('common.confirm')).setDestructive().onClick(async () => { b.setDisabled(true); try { await this.action(); this.close(); } catch { new Notice(t('common.saveFailedRetry')); b.setDisabled(false); } })); }
}
