import { SourceIcons } from './source-icons';
import { addSearchClear } from './search-clear';
import { compareChannelNames } from './channel-order';
import { qiaomuDividers } from './discovery';
import { Component, Platform, setIcon } from 'obsidian';
export type ChannelSection = '聚合' | '乔木分组' | '订阅分组' | '乔木频道' | '我的订阅源';
export interface ChannelChoice { id: string; name: string; section: ChannelSection; subtitle: string; icon?: string; monogram?: string; group?: string; divider?: string; short?: string; site?: string; url?: string; image?: string; kind?: string }
export function channelMark(parent: HTMLElement, choice: ChannelChoice) {
  const mark = parent.createSpan('qrs-channel-mark');
  if (choice.icon) setIcon(mark, choice.icon); else mark.setText(choice.monogram || choice.name.trim().slice(0, 1).toLocaleUpperCase());
  return mark;
}
export class ChannelPicker extends Component {
  private panel!: HTMLElement;
  private rows!: HTMLElement;
  private search!: HTMLInputElement;
  private backdrop?: HTMLElement;
  private expanded = new Set<string>();
  private finished = false;
  constructor(private anchor: HTMLElement, private choices: ChannelChoice[], private active: string, private choose: (choice: ChannelChoice) => void, private dismiss: () => void, private icons?: SourceIcons, private groupState?: { collapsed: string[]; save: (id: string, collapsed: boolean) => void }, private manage?: () => void) { super(); }
  onload() {
    if (this.icons) this.addChild(this.icons);
    const doc = this.anchor.ownerDocument, win = doc.defaultView!;
    const mobile = Platform.isMobileApp || win.innerWidth <= 600;
    if (mobile) { this.backdrop = doc.body.createDiv('qrs-channel-backdrop'); this.backdrop.onclick = () => this.close(); }
    this.panel = doc.body.createDiv({ cls: 'qrs-channel-picker' + (mobile ? ' is-sheet' : ''), attr: { role: 'dialog', 'aria-modal': String(mobile), tabindex: '-1' } });
    const titleId = `qrs-channels-${crypto.randomUUID()}`;
    this.panel.setAttribute('aria-labelledby', titleId);
    const handle = this.panel.createDiv('qrs-channel-handle');
    let startY = 0;
    handle.onpointerdown = e => { startY = e.clientY; handle.setPointerCapture(e.pointerId); };
    handle.onpointerup = e => { if (e.clientY - startY > 60) this.close(); };
    this.panel.createEl('h2', { text: '切换频道', cls: mobile ? 'qrs-channel-heading' : 'qrs-visually-hidden', attr: { id: titleId } });
    const searchId = titleId + '-search';
    this.panel.createEl('label', { text: '搜索频道', cls: 'qrs-visually-hidden', attr: { for: searchId } });
    const top = this.panel.createDiv('qrs-channel-top');
    this.search = top.createEl('input', { type: 'search', placeholder: '搜索频道…', attr: { id: searchId } });
    addSearchClear(this.search);
    if (this.manage) {
      const manage = top.createEl('button', { cls: 'qrs-channel-manage' }); setIcon(manage.createSpan(), 'settings-2'); manage.createSpan({ text: '管理订阅' });
      manage.onclick = () => { this.close(false); this.manage!(); };
    }
    this.rows = this.panel.createDiv('qrs-channel-options');
    if (this.groupState) for (const group of this.choices.filter(c => c.section === '订阅分组')) if (!this.groupState.collapsed.includes(group.id.slice(7))) this.expanded.add(group.id);
    const current = this.choices.find(c => c.id === this.active);
    if (current?.section === '我的订阅源' && current.group) this.expanded.add(`@group:${current.group}`);
    if (current?.section === '乔木频道' && current.divider) this.expanded.add(`@qiaomu:${current.divider}`);
    this.search.oninput = () => this.render();
    this.registerDomEvent(doc, 'pointerdown', e => {
      const node = e.target as Node;
      if (!this.panel.contains(node) && !this.anchor.contains(node)) this.close(false);
    });
    this.registerDomEvent(this.panel, 'keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      const buttons = [...this.rows.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const next = e.key === 'ArrowDown' ? index + 1 : index < 0 ? buttons.length - 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
      } else if (e.key === 'Enter' && doc.activeElement === this.search) { e.preventDefault(); buttons[0]?.click(); }
      else if (e.key === 'Tab') {
        const clear = this.panel.querySelector<HTMLButtonElement>('.qrs-search-clear');
        const fields = [this.search, ...(this.search.value && clear ? [clear] : []), ...buttons]; const at = fields.indexOf(doc.activeElement as HTMLInputElement);
        if (e.shiftKey && at <= 0) { e.preventDefault(); fields.at(-1)?.focus(); }
        else if (!e.shiftKey && at === fields.length - 1) { e.preventDefault(); this.search.focus(); }
      }
    });
    if (!mobile) this.registerDomEvent(win, 'resize', () => this.close());
    this.anchor.setAttribute('aria-expanded', 'true'); this.render();
    if (!mobile) {
      const rect = this.anchor.getBoundingClientRect(), width = Math.min(340, win.innerWidth - 16);
      this.panel.setCssProps({ '--qrs-picker-width': `${width}px`, '--qrs-picker-left': `${Math.max(8, Math.min(rect.left, win.innerWidth - width - 8))}px`, '--qrs-picker-top': `${Math.min(rect.bottom + 6, win.innerHeight - 200)}px`, '--qrs-picker-height': `${Math.max(180, Math.min(520, win.innerHeight - rect.bottom - 14))}px` });
      this.search.focus({ preventScroll: true });
    } else this.panel.focus({ preventScroll: true });
    this.rows.querySelector<HTMLElement>('[aria-current=true]')?.scrollIntoView({ block: 'nearest' });
  }
  private children(choice: ChannelChoice) {
    if (choice.section === '订阅分组') return this.choices.filter(c => c.section === '我的订阅源' && c.group === choice.id.slice(7));
    if (choice.section === '乔木分组') return this.choices.filter(c => c.section === '乔木频道' && c.divider === choice.id.slice(8)).sort(compareChannelNames);
    return [];
  }
  private where(choice: ChannelChoice) {
    if (choice.section === '乔木频道') return `乔木精选 · ${choice.divider}`;
    if (choice.section === '我的订阅源') return `我的订阅${choice.group ? ` · ${this.choices.find(c => c.id === `@group:${choice.group}`)?.name ?? ''}` : ''}`;
    return choice.section === '乔木分组' ? '乔木精选' : choice.section === '订阅分组' ? '我的订阅' : '';
  }
  private render() {
    this.icons?.clear(); this.rows.empty();
    const query = this.search.value.trim().toLocaleLowerCase();
    const row = (choice: ChannelChoice, depth = 0) => {
      const wrap = this.rows.createDiv({ cls: `qrs-channel-option-wrap is-depth-${depth}` + (choice.section === '聚合' ? ' is-all' : '') });
      const button = wrap.createEl('button', { cls: 'qrs-channel-option', attr: { 'data-channel-id': choice.id, 'aria-current': String(choice.id === this.active) } });
      if (this.icons && choice.section === '我的订阅源') this.icons.render(button, choice); else channelMark(button, choice); const copy = button.createSpan('qrs-channel-copy');
      copy.createSpan({ cls: 'qrs-channel-name', text: query ? choice.name : choice.short || choice.name });
      if (query && this.where(choice)) copy.createSpan({ cls: 'qrs-channel-subtitle', text: this.where(choice) });
      else if (choice.section === '乔木分组' || choice.section === '订阅分组') copy.createSpan({ cls: 'qrs-channel-count', text: String(this.children(choice).length) });
      if (choice.id === this.active) setIcon(button.createSpan('qrs-channel-check'), 'check');
      button.onclick = () => { this.close(); this.choose(choice); };
      if (!query && (choice.section === '订阅分组' || choice.section === '乔木分组') && this.children(choice).length) {
        const key = choice.id, open = this.expanded.has(key);
        const toggle = wrap.createEl('button', { cls: 'qrs-channel-expand', attr: { 'aria-expanded': String(open), 'data-group-toggle': key } });
        setIcon(toggle, open ? 'chevron-down' : 'chevron-right'); toggle.createSpan({ cls: 'qrs-visually-hidden', text: `${open ? '收起' : '展开'}${choice.name}` });
        toggle.onclick = () => {
          if (open) this.expanded.delete(key); else this.expanded.add(key);
          if (choice.section === '订阅分组') this.groupState?.save(key.slice(7), open);
          this.render(); this.rows.querySelector<HTMLElement>(`[data-group-toggle="${CSS.escape(key)}"]`)?.focus();
        };
        if (open) this.children(choice).forEach(c => row(c, depth + 1));
      }
    };
    if (query) {
      const matches = this.choices.filter(c => `${c.name} ${c.subtitle} ${this.where(c)}`.toLocaleLowerCase().includes(query));
      matches.forEach(c => row(c));
      if (!matches.length) this.rows.createDiv({ cls: 'qrs-channel-empty', text: '没有匹配频道' });
      return;
    }
    this.rows.createDiv({ cls: 'qrs-channel-section', text: '乔木精选' });
    this.choices.filter(c => c.id === '').forEach(c => row(c));
    for (const divider of qiaomuDividers) { const group = this.choices.find(c => c.id === `@qiaomu:${divider}`); if (group && this.children(group).length) row(group, 1); }
    this.rows.createDiv({ cls: 'qrs-channel-section', text: '我的订阅' });
    this.choices.filter(c => c.id === '@local').forEach(c => row(c));
    this.choices.filter(c => c.section === '订阅分组').forEach(c => row(c, 1));
    this.choices.filter(c => c.section === '我的订阅源' && !c.group).forEach(c => row(c, 1));
  }
  close(focus = true) {
    if (this.finished) return; this.finished = true;
    this.unload(); if (focus && this.anchor.isConnected) this.anchor.focus({ preventScroll: true }); this.dismiss();
  }
  onunload() { this.panel?.remove(); this.backdrop?.remove(); this.anchor.setAttribute('aria-expanded', 'false'); }
}
