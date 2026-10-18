import { Component } from 'obsidian';
import type QiaomuRssPlugin from './main';
import { addSearchClear } from './search-clear';
import { isSourceInput, resolveDocument, resolveSource, sourceUrl, type ResolvedFeed, type SourceResult } from './feed-resolver';
import { MAX_SUBSCRIPTIONS } from './feeds';
import { fail, t } from './i18n';
import type { Subscription } from './model';
import type { Subscriptions } from './subscriptions';

/** Shared by management and discovery: one input, then only the choices the result needs. */
export class SourceInput extends Component {
  input!: HTMLInputElement;
  actions!: HTMLElement;
  private host!: HTMLElement;
  private submitButton!: HTMLButtonElement;
  private fileButton!: HTMLButtonElement;
  private status!: HTMLElement;
  private results!: HTMLElement;
  private footer!: HTMLElement;
  private result?: SourceResult;
  private selected = new Set<string>();
  private serial = 0;
  private closed = false;
  private busy = false;
  private saving = false;
  private composing = false;
  private locked = new Map<HTMLInputElement | HTMLButtonElement, boolean>();
  private slowTimer?: number;
  private receipt: ReturnType<Subscriptions['receipt']> = [];
  constructor(private page: HTMLElement, private plugin: QiaomuRssPlugin, private changed: (query: string) => void, private searchNames: (query: string) => void, private placeholder: string) { super(); }
  onload() {
    this.closed = false;
    this.host = this.page.createDiv('qrs-source-input');
    const form = this.host.createEl('form', { cls: 'qrs-source-form' }), id = crypto.randomUUID(), helpId = crypto.randomUUID();
    form.createEl('label', { cls: 'qrs-visually-hidden', text: this.placeholder, attr: { for: id } });
    this.input = form.createEl('input', { type: 'search', placeholder: this.placeholder, attr: { id, 'aria-describedby': helpId } });
    addSearchClear(this.input);
    this.submitButton = form.createEl('button', { text: t('library.add'), cls: 'mod-cta', type: 'submit' });
    const minor = this.host.createDiv('qrs-source-minor');
    minor.createSpan({ text: t('source.support'), attr: { id: helpId } });
    this.actions = minor.createDiv('qrs-source-actions');
    this.fileButton = this.actions.createEl('button', { text: t('source.file'), cls: 'qrs-link-button', type: 'button' });
    const file = minor.createEl('input', { type: 'file', cls: 'qrs-hidden', attr: { accept: '.opml,.xml', tabindex: '-1' } });
    this.fileButton.onclick = () => { file.value = ''; file.click(); };
    file.onchange = () => { const value = file.files?.[0]; if (value) void this.readFile(value); };
    this.status = this.host.createDiv({ cls: 'qrs-source-status', attr: { role: 'status' } });
    this.results = this.host.createDiv('qrs-source-results');
    this.footer = this.host.createDiv('qrs-source-footer qrs-hidden');
    this.registerDomEvent(this.input, 'compositionstart', () => { this.composing = true; });
    this.registerDomEvent(this.input, 'compositionend', () => { this.composing = false; this.updateInput(); });
    this.input.onkeydown = e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!e.isComposing && !this.composing) void this.submit();
    };
    this.input.oninput = () => { if (!this.composing) this.updateInput(); };
    this.input.onpaste = e => {
      const value = e.clipboardData?.getData('text/plain') || '';
      if (value.trim().startsWith('<') && !this.saving) { e.preventDefault(); void this.readXml(value, t('source.pasted')); }
    };
    form.onsubmit = e => { e.preventDefault(); if (!this.composing) void this.submit(); };
    this.registerDomEvent(this.page, 'dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    this.registerDomEvent(this.page, 'drop', e => { const file = e.dataTransfer?.files[0]; if (file) { e.preventDefault(); if (!this.saving) void this.readFile(file); } });
  }
  setQuery(query: string) { this.input.value = query; this.updateInput(); }
  focus() { this.input.focus({ preventScroll: true }); }
  private active(value: boolean) { this.page.toggleClass('qrs-source-active', value); }
  private message(text: string, action?: () => void, label = t('common.retry')) {
    this.status.empty(); this.status.createSpan({ text });
    if (action) this.status.createEl('button', { text: label, cls: 'qrs-link-button' }).onclick = action;
  }
  private controls() {
    this.submitButton.disabled = this.busy;
    this.submitButton.setText(this.busy ? t('common.loading') : t('library.add'));
    this.submitButton.toggleClass('qrs-hidden', !!this.result);
    this.fileButton.toggleClass('qrs-hidden', !!this.result);
    this.fileButton.disabled = this.busy;
    this.input.disabled = this.saving;
    this.host.toggleClass('is-saving', this.saving);
  }
  private reset() {
    this.serial++; this.busy = false; this.result = undefined;
    this.selected.clear(); this.results.empty(); this.footer.empty(); this.footer.addClass('qrs-hidden');
    this.status.empty(); this.clearSlow(); this.controls();
  }
  cancelRead() { if (this.busy && !this.saving) { this.reset(); this.updateIdle(); } }
  private updateIdle() {
    const source = isSourceInput(this.input.value);
    this.active(source);
    if (source) this.message(t('source.enter'));
  }
  private updateInput() { if (this.saving) return; this.reset(); this.updateIdle(); this.changed(this.input.value); }
  private clearSlow() { this.host.ownerDocument.defaultView!.clearTimeout(this.slowTimer); }
  private start() {
    this.reset(); this.active(true); this.busy = true; this.controls();
    const token = this.serial;
    const cancel = () => { this.reset(); this.updateIdle(); this.message(t('source.cancelled')); };
    this.message(t('discovery.identifying'), cancel, t('common.cancel'));
    this.slowTimer = this.host.ownerDocument.defaultView!.setTimeout(() => { if (this.current(token)) this.message(t('source.stillReading'), cancel, t('common.cancel')); }, 8000);
    return token;
  }
  private current(token: number) { return !this.closed && token === this.serial; }
  private async submit() {
    if (this.busy || this.result) return;
    const value = this.input.value.trim();
    if (!value) { this.focus(); return; }
    if (!isSourceInput(value)) { this.searchNames(value); return; }
    if (value.startsWith('<')) { await this.readXml(value, t('source.pasted')); return; }
    const token = this.start();
    try {
      const existing = this.plugin.state.subscriptions.find(feed => feed.url === sourceUrl(value));
      if (existing) { this.message(t('source.exists', { name: existing.name })); return; }
      const result = await resolveSource(value, this.host.ownerDocument, () => this.current(token));
      if (this.current(token)) await this.accept(result, token);
    } catch (error) { this.error(error, token, () => { void this.submit(); }); }
    finally { this.finishRead(token); }
  }
  private async readFile(file: File) {
    if (this.busy) return;
    const token = this.start();
    try {
      if (file.size > 5 * 1024 * 1024) fail('error.fileTooLarge');
      const xml = await file.text();
      if (!this.current(token)) return;
      this.input.value = file.name;
      await this.accept(await resolveDocument(xml, undefined, this.host.ownerDocument), token, true);
    } catch (error) { this.error(error, token, () => { void this.readFile(file); }); }
    finally { this.finishRead(token); }
  }
  private async readXml(xml: string, name: string) {
    const token = this.start(); this.input.value = name;
    try { await this.accept(await resolveDocument(xml, undefined, this.host.ownerDocument), token, true); }
    catch (error) { this.error(error, token, () => { void this.readXml(xml, name); }); }
    finally { this.finishRead(token); }
  }
  private async accept(result: SourceResult, token: number, local = false) {
    if (!this.current(token)) return;
    this.clearSlow(); this.status.empty();
    if (result.kind === 'feed') {
      // Verify the canonical URL from a local XML file before subscribing to its live feed.
      if (local) { const live = await resolveSource(result.url, this.host.ownerDocument, () => this.current(token)); if (live.kind !== 'feed') fail('source.needOnlineUrl'); result = live; }
      await this.addFeed(result, token); return;
    }
    this.result = result; this.busy = false; this.controls(); this.active(true);
    if (result.kind === 'opml') {
      this.selected = new Set(result.feeds.filter(f => !this.existing(f.url)).map(f => f.url)); this.renderBatch();
    } else {
      this.results.createDiv({ cls: 'qrs-source-heading', text: t('source.choose', { n: result.feeds.length }) });
      if (result.failed) this.results.createDiv({ cls: 'qrs-source-detail', text: t('source.partial', { n: result.failed }) });
      for (const feed of result.feeds) {
        const row = this.results.createDiv('qrs-source-row'), info = row.createDiv('qrs-source-copy');
        info.createDiv({ text: feed.parsed.name }); info.createDiv({ text: new URL(feed.url).hostname, cls: 'qrs-source-detail' });
        const button = row.createEl('button', { text: this.existing(feed.url) ? t('discovery.subscribed') : t('library.add') }); button.disabled = !!this.existing(feed.url);
        button.onclick = () => { if (this.busy) return; void this.addFeed(feed, token).catch(e => this.error(e, token)).finally(() => this.finishRead(token)); };
      }
      this.results.createEl('button', { text: t('common.cancel'), cls: 'qrs-link-button' }).onclick = () => this.updateInput();
    }
  }
  private existing(url: string) { return this.plugin.state.subscriptions.find(f => f.url === url); }
  private lock() {
    for (const control of this.host.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) { this.locked.set(control, control.disabled); control.disabled = true; }
    this.busy = true; this.saving = true; this.controls();
  }
  private unlock() { for (const [control, disabled] of this.locked) control.disabled = disabled; this.locked.clear(); }
  private async addFeed(feed: ResolvedFeed, token: number) {
    if (!this.current(token)) return;
    const existing = this.existing(feed.url);
    if (existing) { this.message(t('source.exists', { name: existing.name })); return; }
    this.lock();
    const added = await this.plugin.subscriptions.addResolved(feed, '', () => this.current(token));
    if (this.current(token)) this.success([added], t('source.added', { name: added.name }));
  }
  private success(added: Subscription[], text: string) {
    this.receipt = this.plugin.subscriptions.receipt(added);
    this.unlock(); this.saving = false; this.reset(); this.input.value = ''; this.active(false); this.changed('');
    this.message(text, () => { void this.undo(); }, t('source.undo'));
  }
  private async undo() {
    if (this.busy) return;
    this.lock(); const token = this.serial;
    try {
      const count = await this.plugin.subscriptions.undoAdded(this.receipt);
      if (this.current(token)) { this.receipt = []; this.message(t('source.undone', { n: count })); this.changed(this.input.value); }
    } catch (e) { this.error(e, token, () => { void this.undo(); }); }
    finally { this.finishRead(token); }
  }
  private finishRead(token: number) { if (this.current(token)) { this.unlock(); this.busy = false; this.saving = false; this.clearSlow(); this.controls(); } }
  private error(error: unknown, token: number, retry?: () => void) { if (this.current(token)) this.message(error instanceof Error ? error.message : t('common.saveFailedRetry'), retry); }
  private renderBatch() {
    if (this.result?.kind !== 'opml') return;
    const result = this.result, head = this.results.createDiv('qrs-source-batch-head'), copy = head.createDiv();
    copy.createDiv({ cls: 'qrs-source-heading', text: t('source.opml') });
    copy.createDiv({ cls: 'qrs-source-detail', text: t('source.batchDetail', { total: result.feeds.length, existing: result.feeds.filter(f => this.existing(f.url)).length, skipped: result.skipped }) });
    head.createEl('button', { text: t('common.cancel'), cls: 'qrs-link-button' }).onclick = () => { if (!this.busy) this.updateInput(); };
    let query = '', limit = 60;
    let filter: HTMLInputElement | undefined, all: HTMLInputElement | undefined;
    if (result.feeds.length > 8) {
      const id = crypto.randomUUID(); this.results.createEl('label', { cls: 'qrs-visually-hidden', text: t('modal.filterImport'), attr: { for: id } });
      filter = this.results.createEl('input', { type: 'search', placeholder: t('modal.filterPlaceholder'), attr: { id } });
      const label = this.results.createEl('label', { cls: 'qrs-source-select-all' }); all = label.createEl('input', { type: 'checkbox' }); label.createSpan({ text: t('modal.selectFiltered') });
    }
    const list = this.results.createDiv('qrs-source-picks'); this.footer.removeClass('qrs-hidden');
    const count = this.footer.createSpan(), button = this.footer.createEl('button', { cls: 'mod-cta' });
    const filtered = () => result.feeds.filter(f => `${f.name} ${f.group}`.toLocaleLowerCase().includes(query));
    const update = () => {
      const size = result.feeds.filter(f => this.selected.has(f.url) && !this.existing(f.url)).length;
      count.setText(t('library.bulk.selected', { n: size })); button.setText(t('modal.importCount', { n: size }));
      const over = size + this.plugin.state.subscriptions.length > MAX_SUBSCRIPTIONS;
      button.disabled = !size || this.busy || over;
      if (over) this.message(t('error.importLimit', { n: MAX_SUBSCRIPTIONS }));
      else if (!this.busy) this.status.empty();
      if (all) { const values = filtered().filter(f => !this.existing(f.url)); all.checked = !!values.length && values.every(f => this.selected.has(f.url)); all.indeterminate = !all.checked && values.some(f => this.selected.has(f.url)); }
    };
    const render = () => {
      list.empty(); const values = filtered();
      for (const feed of values.slice(0, limit)) {
        const row = list.createEl('label', { cls: 'qrs-source-row' }), check = row.createEl('input', { type: 'checkbox' });
        check.checked = this.selected.has(feed.url) && !this.existing(feed.url); check.disabled = !!this.existing(feed.url);
        const info = row.createSpan('qrs-source-copy'); info.createSpan({ text: feed.name }); info.createSpan({ cls: 'qrs-source-detail', text: feed.group || t('common.ungrouped') });
        if (check.disabled) row.createSpan({ cls: 'qrs-source-detail', text: t('discovery.subscribed') });
        check.onchange = () => { if (this.busy) return; if (check.checked) this.selected.add(feed.url); else this.selected.delete(feed.url); update(); };
      }
      if (values.length > limit) list.createEl('button', { text: t('common.showMore') }).onclick = () => { limit += 60; render(); };
      update();
    };
    if (filter) filter.oninput = () => { query = filter.value.toLocaleLowerCase(); limit = 60; render(); };
    if (all) all.onchange = () => { for (const feed of filtered()) if (!this.existing(feed.url)) { if (all.checked) this.selected.add(feed.url); else this.selected.delete(feed.url); } render(); };
    button.onclick = () => {
      if (this.busy) return;
      const chosen = result.feeds.filter(f => this.selected.has(f.url) && !this.existing(f.url)), token = this.serial;
      this.lock(); button.disabled = true;
      void this.plugin.subscriptions.importAdded(chosen, () => this.current(token)).then(added => {
        if (this.current(token)) this.success(added, t('notice.importedFeeds', { n: added.length }));
      }).catch(e => { this.error(e, token); }).finally(() => { this.finishRead(token); if (this.current(token)) button.disabled = !this.selected.size; });
    };
    render();
  }
  onunload() { this.closed = true; this.serial++; this.clearSlow(); }
}
