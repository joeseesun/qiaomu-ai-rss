import { Modal, Notice, type App } from 'obsidian';
import type QiaomuRssPlugin from './main';
import type { Entry, Source } from './model';
import { qiaomuChannelDivider } from './discovery';
import { dividerLabel, t } from './i18n';

export class MoveArticleModal extends Modal {
  private closed = false;
  constructor(app: App, private plugin: QiaomuRssPlugin, private entry: Entry) { super(app); }
  async onOpen() {
    this.modalEl.addClasses(['qrs-modal', 'qrs-pick-modal']);
    this.contentEl.addClass('qrs-pick');
    this.setTitle(t('moderation.move'));
    this.contentEl.createDiv({ cls: 'qrs-pick-lead', text: this.entry.titleZh || this.entry.title });
    const searchId = `qrs-move-search-${crypto.randomUUID()}`;
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: t('pick.search'), attr: { for: searchId } });
    const search = this.contentEl.createEl('input', { cls: 'qrs-pick-search', type: 'search', attr: { id: searchId, placeholder: t('pick.search') } });
    const list = this.contentEl.createDiv('qrs-pick-list');
    const foot = this.contentEl.createDiv('qrs-pick-foot');
    const status = foot.createDiv({ cls: 'qrs-pick-count', attr: { 'aria-live': 'polite' } });
    const actions = foot.createDiv('qrs-pick-actions');
    actions.createEl('button', { text: t('common.cancel') }).onclick = () => this.close();
    const button = actions.createEl('button', { cls: 'mod-cta', text: t('moderation.moveConfirm'), attr: { disabled: true } });
    let sources: Source[] = [], selected = '', busy = false;
    const baseUrl = this.plugin.state.settings.baseUrl;
    const render = () => {
      list.empty();
      const query = search.value.trim().toLocaleLowerCase();
      let previous = '';
      let count = 0;
      for (const source of sources.filter(s => `${s.name} ${dividerLabel(qiaomuChannelDivider(s))}`.toLocaleLowerCase().includes(query))) {
        count++;
        const group = dividerLabel(qiaomuChannelDivider(source));
        if (group !== previous) list.createDiv({ cls: 'qrs-pick-group', text: group });
        previous = group;
        const row = list.createEl('label', { cls: 'qrs-pick-row' });
        const radio = row.createEl('input', { type: 'radio', attr: { name: 'qrs-move-target' } });
        radio.checked = selected === source.id; radio.disabled = busy;
        row.createSpan({ cls: 'qrs-pick-name', text: source.name });
        radio.onchange = () => { selected = source.id; button.disabled = busy || selected === this.entry.sourceId; };
      }
      if (!count) list.createDiv({ cls: 'qrs-pick-empty', text: t('pick.empty') });
    };
    search.oninput = render;
    status.setText(t('pick.loading'));
    try {
      const [catalog, current] = await Promise.all([this.plugin.articleMoveChannels(), this.plugin.api().article(this.entry.id)]);
      sources = catalog; this.entry = current.bundle.entry;
      if (this.closed || baseUrl !== this.plugin.state.settings.baseUrl) return;
      sources.sort((a, b) => qiaomuChannelDivider(a).localeCompare(qiaomuChannelDivider(b)) || a.name.localeCompare(b.name));
      selected = this.entry.sourceId; status.empty(); render();
    } catch { if (!this.closed) status.setText(t('moderation.moveFailed')); }
    button.onclick = async () => {
      if (busy || !selected) return;
      if (baseUrl !== this.plugin.state.settings.baseUrl) { status.setText(t('moderation.moveFailed')); return; }
      busy = true; button.disabled = true; search.disabled = true; render();
      try {
        const name = await this.plugin.moveArticle(this.entry, selected, baseUrl);
        new Notice(t('moderation.moved', { name })); this.close();
      } catch (error) { if (!this.closed) status.setText(error instanceof Error ? error.message : t('moderation.moveFailed')); }
      finally { busy = false; if (!this.closed) { button.disabled = false; search.disabled = false; render(); } }
    };
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
