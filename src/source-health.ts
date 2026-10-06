import { Modal, Notice, type App } from 'obsidian';
import type { State } from './model';
import { computeSourceStats, formatLastOpen } from './source-stats';
import { t } from './i18n';

/** Reading-health modal: rank sources by recent opens, unsubscribe sleepers with an arm-to-confirm step. */
export class SourceHealthModal extends Modal {
  private armed: string | null = null;
  constructor(
    app: App,
    private getState: () => State,
    private unsubscribe: (id: string) => Promise<void>,
    private onChanged: () => void,
  ) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty(); contentEl.addClass('qrs-health');
    this.modalEl.addClass('qrs-modal', 'qrs-health-modal');
    this.setTitle(t('stats.title'));
    contentEl.createEl('p', { text: t('stats.note'), cls: 'qrs-health-note' });
    const body = contentEl.createDiv('qrs-health-body');
    const actions = contentEl.createDiv('qrs-health-foot');
    actions.createEl('button', { text: t('common.close'), cls: 'mod-cta' }).addEventListener('click', () => this.close());
    const render = () => {
      body.empty();
      const stats = computeSourceStats(this.getState());
      const sleepers = stats.filter(item => item.opened30d === 0).length;
      body.createEl('p', { text: t('stats.summary', { n: stats.length, m: sleepers }), cls: 'qrs-health-summary' });
      if (!stats.length) return;
      const table = body.createEl('table', { cls: 'qrs-health-table' });
      const head = table.createEl('tr');
      const columns = ['stats.col.source', 'stats.col.group', 'stats.col.cached', 'stats.col.openedEver', 'stats.col.opened30d', 'stats.col.lastOpen', 'stats.col.action'] as const;
      for (const key of columns) head.createEl('th', { text: t(key) });
      for (const stat of stats) {
        const row = table.createEl('tr');
        if (this.armed === stat.id) row.addClass('is-armed');
        row.createEl('td', { text: stat.name });
        row.createEl('td', { text: stat.group });
        row.createEl('td', { text: String(stat.entries) });
        row.createEl('td', { text: String(stat.openedEver) });
        row.createEl('td', { text: String(stat.opened30d) });
        row.createEl('td', { text: formatLastOpen(stat.lastOpen) });
        const cell = row.createEl('td');
        if (stat.opened30d === 0) {
          const button = cell.createEl('button', { text: this.armed === stat.id ? t('stats.confirmUnsubscribe') : t('stats.unsubscribe'), cls: this.armed === stat.id ? 'mod-warning' : '' });
          button.addEventListener('click', () => {
            if (this.armed !== stat.id) { this.armed = stat.id; render(); return; }
            void this.unsubscribe(stat.id).then(() => {
              this.armed = null; this.onChanged(); render();
              new Notice(t('stats.unsubscribed', { name: stat.name }));
            }).catch(() => new Notice(t('stats.unsubscribeFailed')));
          });
        }
      }
    };
    render();
  }
  onClose() { this.contentEl.empty(); }
}
