import { Modal, Notice, type App } from 'obsidian';
import type { State } from './model';
import { computeSourceStats, formatLastOpen } from './source-stats';

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
    contentEl.createEl('h2', { text: '来源阅读统计' });
    contentEl.createEl('p', { text: '按近 30 天打开数排序。只统计当前缓存文章（每源最多 50 篇），被轮换掉的历史不计入。长期 0 打开的源建议退订或降为“仅标题”。', cls: 'qrs-health-note' });
    const stats = computeSourceStats(this.getState());
    const sleepers = stats.filter(s => s.opened30d === 0).length;
    contentEl.createEl('p', { text: `${stats.length} 个源 · 近 30 天零打开 ${sleepers} 个`, cls: 'qrs-health-summary' });
    const table = contentEl.createEl('table', { cls: 'qrs-health-table' });
    const head = table.createEl('tr');
    for (const label of ['来源', '分组', '缓存', '累计打开', '近30天', '上次打开', '操作']) head.createEl('th', { text: label });
    for (const stat of stats) {
      const row = table.createEl('tr');
      row.createEl('td', { text: stat.name });
      row.createEl('td', { text: stat.group });
      row.createEl('td', { text: String(stat.entries) });
      row.createEl('td', { text: String(stat.openedEver) });
      row.createEl('td', { text: String(stat.opened30d) });
      row.createEl('td', { text: formatLastOpen(stat.lastOpen) });
      const cell = row.createEl('td');
      const button = cell.createEl('button', { text: this.armed === stat.id ? '确认取消订阅？' : '取消订阅' });
      button.addEventListener('click', () => {
        if (this.armed !== stat.id) { this.armed = stat.id; button.setText('确认取消订阅？'); return; }
        void this.unsubscribe(stat.id).then(() => {
          this.armed = null; this.onChanged(); this.onOpen();
          new Notice(`已取消订阅：${stat.name}`);
        }).catch(() => new Notice('取消订阅失败。'));
      });
    }
    const close = contentEl.createEl('button', { text: '关闭' });
    close.addEventListener('click', () => this.close());
  }
  onClose() { this.contentEl.empty(); }
}
