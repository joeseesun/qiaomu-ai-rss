// Qiaomu update notes: native modal, offline copy, isolated metadata, one queue per vault.
import { Modal, Notice, Plugin, getLanguage, normalizePath, setIcon, type App } from 'obsidian';
import { updateText, type UpdateMessage } from './update-notes-i18n';

export interface UpdateEntry { version: string; items: UpdateMessage[] }
interface Preferences { seenVersion: string; autoShow: boolean }
interface Job { id: string; manual: boolean; run: () => void }
interface Queue { jobs: Job[]; active: string | null; timer: number | null; pump: () => void }
const queueKey = Symbol.for('qiaomu.update-notes.queue.v1');

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
export function readPreferences(raw: unknown): Preferences {
  const value = raw && typeof raw === 'object' ? raw as Partial<Preferences> : {};
  return { seenVersion: typeof value.seenVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.seenVersion) ? value.seenVersion : '', autoShow: value.autoShow !== false };
}
export function unseenEntries(entries: UpdateEntry[], seen: string, current: string): UpdateEntry[] {
  return entries.filter(entry => compareVersions(entry.version, current) <= 0 && (!seen || compareVersions(entry.version, seen) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}
function queueFor(app: App): Queue {
  const owner = app as App & { [queueKey]?: Queue };
  if (owner[queueKey]) return owner[queueKey];
  const queue: Queue = { jobs: [], active: null, timer: null, pump: () => {} };
  queue.pump = () => {
    if (!queue.jobs.length) {
      if (queue.timer !== null) window.clearInterval(queue.timer);
      queue.timer = null;
      return;
    }
    // Respect setup dialogs, command palettes and another plugin's release notes.
    if (queue.active) return;
    const index = document.querySelector('.modal-container') ? queue.jobs.findIndex(job => job.manual) : 0;
    if (index < 0) return;
    const job = queue.jobs.splice(index, 1)[0];
    if (job) { queue.active = job.id; job.run(); }
  };
  owner[queueKey] = queue;
  return queue;
}

export class UpdateNotes {
  private preferences: Preferences = readPreferences(null);
  private readonly path: string;
  private readonly ready: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private writable = true;
  private modal: NotesModal | null = null;
  private pendingAutomatic = false;

  constructor(private readonly plugin: Plugin, private readonly entries: UpdateEntry[], private readonly language: () => string = getLanguage) {
    this.path = normalizePath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/update-notes.json`);
    this.ready = this.load();
    plugin.addCommand({ id: 'view-update-notes', name: this.text('view'), callback: () => this.show() });
    plugin.register(() => this.dispose());
    plugin.app.workspace.onLayoutReady(() => {
      void this.ready.then(() => {
        if (!this.disposed && this.preferences.autoShow && compareVersions(plugin.manifest.version, this.preferences.seenVersion) > 0) this.enqueue(true);
      });
    });
  }
  text(key: UpdateMessage): string { return updateText(this.language(), key); }
  addButton(parent: HTMLElement): void {
    const button = parent.createEl('button', { text: this.text('view'), cls: 'qiaomu-update-notes-link', attr: { type: 'button' } });
    const icon = button.createSpan({ attr: { 'aria-hidden': 'true' } });
    setIcon(icon, 'history'); button.prepend(icon);
    button.addEventListener('click', () => this.show());
  }
  show(): void { void this.ready.then(() => { if (!this.disposed) this.enqueue(false); }); }
  private async load(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      if (await adapter.exists(this.path)) this.preferences = readPreferences(JSON.parse(await adapter.read(this.path)));
    } catch {
      this.writable = false;
      // Leave unreadable metadata untouched; a manual view still works.
      this.preferences = { seenVersion: this.plugin.manifest.version, autoShow: false };
    }
  }
  private save(patch: Partial<Preferences>): Promise<void> {
    const task = this.writeQueue.catch(() => {}).then(async () => {
      if (this.disposed) return;
      if (!this.writable) throw new Error('Update metadata is unreadable');
      const next = { ...this.preferences, ...patch };
      await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(next));
      this.preferences = next;
    });
    this.writeQueue = task;
    return task;
  }
  private enqueue(automatic: boolean): void {
    if (this.modal || this.disposed) return;
    const queue = queueFor(this.plugin.app), id = this.plugin.manifest.id;
    const existing = queue.jobs.find(job => job.id === id);
    if (existing) { if (!automatic) { this.pendingAutomatic = false; existing.manual = true; } return; }
    this.pendingAutomatic = automatic;
    queue.jobs.push({ id, manual: !automatic, run: () => this.open(queue) });
    if (queue.timer === null) queue.timer = window.setInterval(() => queue.pump(), 300);
  }
  private open(queue: Queue): void {
    if (this.disposed) { queue.active = null; queue.pump(); return; }
    const current = this.plugin.manifest.version;
    const entries = unseenEntries(this.entries, this.pendingAutomatic ? this.preferences.seenVersion : '', current);
    this.modal = new NotesModal(this.plugin.app, this.plugin.manifest.name, current, entries, key => this.text(key), this.preferences.autoShow,
      async enabled => {
        await this.save({ autoShow: enabled });
      }, () => { this.modal = null; queue.active = null; });
    this.modal.open();
    const seenVersion = compareVersions(current, this.preferences.seenVersion) > 0 ? current : this.preferences.seenVersion;
    void this.save({ seenVersion }).catch(() => { if (!this.disposed) new Notice(this.text('saveError')); });
  }
  private dispose(): void {
    this.disposed = true;
    const queue = queueFor(this.plugin.app);
    queue.jobs = queue.jobs.filter(job => job.id !== this.plugin.manifest.id);
    this.modal?.close(); queue.pump();
  }
}

class NotesModal extends Modal {
  constructor(app: App, private readonly name: string, private readonly version: string, private readonly entries: UpdateEntry[],
    private readonly text: (key: UpdateMessage) => string, private enabled: boolean,
    private readonly change: (enabled: boolean) => Promise<void>, private readonly finished: () => void) { super(app); }
  override onOpen(): void {
    this.modalEl.addClass('qiaomu-update-notes');
    this.modalEl.dir = this.text('done') === 'حسنًا' ? 'rtl' : 'ltr';
    this.setTitle(`${this.name} · ${this.text('title')}`);
    const content = this.contentEl;
    content.createEl('p', { text: `v${this.version}`, cls: 'qiaomu-update-notes-version' });
    const entries = this.entries.length ? this.entries : [{ version: this.version, items: ['fallback'] as UpdateMessage[] }];
    for (const entry of entries) {
      const section = content.createEl('section', { cls: 'qiaomu-update-notes-section' });
      if (entries.length > 1) section.createEl('h3', { text: `v${entry.version}` });
      const list = section.createEl('ul');
      for (const item of entry.items) list.createEl('li', { text: this.text(item) });
    }
    const footer = content.createDiv({ cls: 'qiaomu-update-notes-footer' });
    const label = footer.createEl('label', { cls: 'qiaomu-update-notes-option' });
    const input = label.createEl('input', { attr: { type: 'checkbox' } });
    input.checked = this.enabled;
    label.createSpan({ text: this.text('automatic') });
    input.addEventListener('change', () => {
      const desired = input.checked; input.disabled = true;
      void this.change(desired).then(() => { this.enabled = desired; }).catch(() => {
        input.checked = this.enabled; new Notice(this.text('saveError'));
      }).finally(() => { input.disabled = false; });
    });
    const close = footer.createEl('button', { text: this.text('done'), cls: 'qiaomu-update-notes-done', attr: { type: 'button' } });
    close.addEventListener('click', () => this.close());
  }
  override onClose(): void { this.contentEl.empty(); this.finished(); }
}
