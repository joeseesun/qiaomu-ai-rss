import { Modal, Notice } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { titleOf, type LocalDeletion } from './model';
import { addSearchClear } from './search-clear';
import { t } from './i18n';

export class DeletedArticlesModal extends Modal {
  private query = '';
  private limit = 50;
  private list?: HTMLElement;
  private all?: HTMLButtonElement;
  private busy = false;
  constructor(private plugin: QiaomuRssPlugin) { super(plugin.app); }
  onOpen() {
    this.modalEl.addClasses(['qrs-modal', 'qrs-deleted-modal']);
    this.setTitle(t('localDelete.title'));
    this.contentEl.createEl('p', { text: t('localDelete.description'), cls: 'qrs-deleted-description' });
    const id = `qrs-deleted-search-${crypto.randomUUID()}`;
    this.contentEl.createEl('label', { text: t('localDelete.search'), cls: 'qrs-visually-hidden', attr: { for: id } });
    const search = this.contentEl.createEl('input', { type: 'search', placeholder: t('localDelete.search'), cls: 'qrs-deleted-search', attr: { id } });
    addSearchClear(search);
    search.oninput = () => { this.query = search.value; this.limit = 50; this.refresh(); };
    this.list = this.contentEl.createDiv('qrs-deleted-list');
    const footer = this.contentEl.createDiv('qrs-deleted-footer');
    this.all = footer.createEl('button', { text: t('localDelete.restoreAll') });
    this.all.onclick = () => { void this.restore([...this.plugin.state.localDeletedEntries]); };
    footer.createEl('button', { text: t('common.close'), cls: 'mod-cta' }).onclick = () => this.close();
    this.refresh();
  }
  refresh() {
    if (!this.list?.isConnected) return;
    const top = this.list.scrollTop;
    this.list.empty();
    const query = this.query.trim().toLocaleLowerCase();
    const records = [...this.plugin.state.localDeletedEntries].sort((a, b) => b.deletedAt - a.deletedAt)
      .filter(record => `${titleOf(record.entry)} ${record.entry.sourceName || ''} ${record.entry.link || ''}`.toLocaleLowerCase().includes(query));
    if (this.all) this.all.disabled = this.busy || !this.plugin.state.localDeletedEntries.length;
    if (!records.length) this.list.createDiv({ text: t('localDelete.empty'), cls: 'qrs-deleted-empty' });
    for (const record of records.slice(0, this.limit)) {
      const row = this.list.createDiv('qrs-deleted-row');
      const copy = row.createDiv('qrs-deleted-copy');
      copy.createEl('strong', { text: titleOf(record.entry) });
      copy.createSpan({ text: [record.entry.sourceName, new Date(record.deletedAt).toLocaleString()].filter(Boolean).join(' · ') });
      if (record.entry.link) copy.createSpan({ text: record.entry.link });
      const button = row.createEl('button', { text: t('localDelete.restore') });
      button.disabled = this.busy; button.onclick = () => { void this.restore([record]); };
    }
    if (records.length > this.limit) this.list.createEl('button', { text: t('reader.loadEarlier'), cls: 'qrs-deleted-more' }).onclick = () => { this.limit += 50; this.refresh(); };
    this.list.scrollTop = top;
  }
  private async restore(records: LocalDeletion[]) {
    if (this.busy) return;
    this.busy = true; this.refresh();
    try { await this.plugin.restoreLocalArticles(records); }
    catch { new Notice(t('localDelete.failed')); }
    finally { this.busy = false; this.refresh(); }
  }
  onClose() { this.contentEl.empty(); this.list = undefined; }
}
