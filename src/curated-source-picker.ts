import { Modal, Notice } from 'obsidian';
import type QiaomuRssPlugin from './main';
import type { Source } from './model';
import { qiaomuChannelDivider, qiaomuDividers, readerChannelSources } from './discovery';
import { compareChannelNames } from './channel-order';
import { dividerLabel, t } from './i18n';

export class CuratedSourcePicker extends Modal {
  private catalog: Source[] = [];
  private matching: Source[] = [];
  private selected: Set<string>;
  private known: Set<string>;
  private query = '';
  private facet = '';
  private ready = false;
  private saving = false;
  private closed = false;
  private list!: HTMLElement;
  private facets!: HTMLElement;
  private count!: HTMLElement;
  private saveButton!: HTMLButtonElement;
  constructor(private plugin: QiaomuRssPlugin) {
    super(plugin.app);
    this.selected = new Set(plugin.state.settings.pickedSourceIds ?? []);
    this.known = new Set(this.selected);
  }
  async onOpen() {
    this.modalEl.addClasses(['qrs-modal', 'qrs-pick-modal']);
    this.setTitle(t('pick.title'));
    this.contentEl.addClass('qrs-pick');
    const lead = this.contentEl.createDiv('qrs-pick-lead');
    lead.createEl('p', { text: t('pick.description') });
    lead.createEl('p', { cls: 'qrs-pick-note', text: t('pick.note') });
    const searchId = `qrs-pick-search-${crypto.randomUUID()}`;
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: t('pick.search'), attr: { for: searchId } });
    const search = this.contentEl.createEl('input', { cls: 'qrs-pick-search', type: 'search', attr: { id: searchId, placeholder: t('pick.search') } });
    search.addEventListener('input', () => { this.query = search.value.trim().toLocaleLowerCase(); this.renderList(); });
    this.facets = this.contentEl.createDiv({ cls: 'qrs-pick-facets', attr: { role: 'group', 'aria-label': t('pick.title') } });
    this.list = this.contentEl.createDiv('qrs-pick-list');
    this.list.createDiv({ cls: 'qrs-pick-empty', text: t('pick.loading') });
    const foot = this.contentEl.createDiv('qrs-pick-foot');
    this.count = foot.createDiv({ cls: 'qrs-pick-count', attr: { 'aria-live': 'polite' } });
    const actions = foot.createDiv('qrs-pick-actions');
    actions.createEl('button', { text: t('pick.select') }).onclick = () => {
      if (!this.ready || this.saving) return;
      for (const source of this.matching) this.selected.add(source.id);
      this.renderList();
    };
    actions.createEl('button', { text: t('pick.clear') }).onclick = () => {
      if (!this.ready || this.saving) return;
      for (const source of this.matching) this.selected.delete(source.id);
      this.renderList();
    };
    actions.createEl('button', { text: t('pick.visibleOnly') }).onclick = () => {
      if (!this.ready || this.saving) return;
      this.selected = new Set(readerChannelSources(this.catalog).map(source => source.id));
      this.facet = ''; this.renderFacets(); this.renderList();
    };
    actions.createEl('button', { text: t('pick.restore') }).onclick = () => { void this.save(null); };
    this.saveButton = actions.createEl('button', { text: t('pick.save'), cls: 'mod-cta', attr: { disabled: true } });
    this.saveButton.onclick = () => { void this.save([...this.selected]); };
    try { this.catalog = (await this.plugin.api().sources()).sources; }
    catch { this.catalog = this.plugin.state.sources; }
    if (this.closed) return;
    if (!this.catalog.length) this.catalog = this.plugin.state.sources;
    this.catalog = [...new Map(this.catalog.map(source => [source.id, source])).values()];
    if (this.plugin.state.settings.pickedSourceIds === null) this.selected = new Set(this.catalog.map(source => source.id));
    this.ready = true;
    this.saveButton.disabled = !this.catalog.length;
    this.renderFacets(); this.renderList();
  }
  private renderFacets() {
    this.facets.empty();
    for (const facet of ['', ...qiaomuDividers]) {
      const button = this.facets.createEl('button', { text: facet ? dividerLabel(facet) : t('common.all'), cls: facet === this.facet ? 'is-on' : '', attr: { type: 'button', 'aria-pressed': String(facet === this.facet) } });
      button.onclick = () => { this.facet = facet; this.renderFacets(); this.renderList(); };
    }
  }
  private renderList() {
    if (!this.ready) return;
    this.list.empty();
    const visible = new Set(readerChannelSources(this.catalog).map(source => source.id));
    const rank = (source: Source) => (qiaomuDividers as readonly string[]).indexOf(qiaomuChannelDivider(source));
    this.matching = this.catalog.filter(source => (!this.facet || qiaomuChannelDivider(source) === this.facet) &&
      (!this.query || `${source.name} ${source.siteUrl ?? ''} ${source.id}`.toLocaleLowerCase().includes(this.query)))
      .sort((a, b) => rank(a) - rank(b) || compareChannelNames(a, b));
    if (!this.matching.length) this.list.createDiv({ cls: 'qrs-pick-empty', text: t(this.catalog.length ? 'pick.empty' : 'pick.unavailable') });
    let group = '';
    for (const source of this.matching) {
      const divider = qiaomuChannelDivider(source);
      if (group !== divider) { group = divider; this.list.createDiv({ cls: 'qrs-pick-group', text: dividerLabel(divider) }); }
      const shown = visible.has(source.id);
      const row = this.list.createEl('label', { cls: `qrs-pick-row${shown ? '' : ' is-off'}` });
      const checkbox = row.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.selected.has(source.id);
      checkbox.onchange = () => { if (checkbox.checked) this.selected.add(source.id); else this.selected.delete(source.id); this.updateCount(); };
      const copy = row.createDiv('qrs-pick-copy');
      copy.createDiv({ cls: 'qrs-pick-name', text: source.name || source.id });
      if (source.siteUrl) copy.createDiv({ cls: 'qrs-pick-desc', text: source.siteUrl });
      row.createDiv({ cls: `qrs-pick-badge${shown ? ' is-on' : ''}`, text: t(source.enabled === false ? 'pick.disabled' : source.category === 'community' ? 'pick.community' : shown ? 'pick.visible' : 'pick.hidden') });
    }
    this.updateCount();
  }
  private updateCount() { this.count.setText(t('pick.count', { n: this.selected.size, total: this.catalog.length })); }
  private async save(ids: string[] | null) {
    if (!this.ready || this.saving || ids !== null && !this.catalog.length) return;
    this.saving = true;
    const controls = this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input');
    controls.forEach(control => { control.disabled = true; });
    try {
      const available = new Set(this.catalog.map(source => source.id));
      await this.plugin.saveCuratedSources(ids === null ? null : ids.filter(id => available.has(id) || this.known.has(id)), this.catalog);
      new Notice(t(ids === null ? 'pick.restored' : 'pick.saved')); this.close();
    } catch {
      new Notice(t('common.saveFailedRetry'));
      this.saving = false; controls.forEach(control => { control.disabled = false; });
    }
  }
  onClose() { this.closed = true; this.contentEl.empty(); }
}
