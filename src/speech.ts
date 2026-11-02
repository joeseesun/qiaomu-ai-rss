import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { mobileSpeechSettings } from './speech-platform';
import { openVoicePicker, SpeechService, createLocalTtsManager, normalizeSettings, rememberProgress, resumeOffset } from '@qiaomu/speech/speech';
import type { LocalManager, SpeechOwner, SpeechSettings, VoiceCatalog } from '@qiaomu/speech/speech';
import type QiaomuRssPlugin from './main';
import type { ReaderView } from './view';
import { t, locale, type MessageKey } from './i18n';
import { applyHighlightAppearance } from './speech-highlight';
import { articleSpeechSource, articleSelection, sameSpeechRange, type ArticleSpeechItem } from './speech-source';
export interface SpeechContext { id: string; mode: string; prose: HTMLElement | null; loading: boolean }
export function speechError(error: unknown): string {
  const e = error && typeof error === 'object' ? error as { code?: string; status?: number } : {};
  if (e.status === 429 || e.code === 'rateLimit') return t('speech.rateLimit');
  if (e.status === 401 || e.status === 403) return t('speech.auth');
  if (['key', 'configuration', 'region', 'resource', 'url', 'https', 'voice', 'provider'].includes(e.code || '')) return t('speech.configuration');
  if (['localMissing', 'localEnvironment', 'localPlatform', 'localBusy', 'localInstall'].includes(e.code || '')) return t('speech.setup');
  return t('speech.failure');
}
export function speechButton(parent: HTMLElement, icon: string, label: string, run: (event: MouseEvent) => void) {
  const button = parent.createEl('button', { cls: 'qrs-speech-button', attr: { type: 'button' } });
  const mark = button.createSpan({ attr: { 'aria-hidden': 'true' } }); setIcon(mark, icon);
  const text = button.createSpan({ cls: 'qrs-visually-hidden', text: label });
  button.dataset.qrsTip = 'speech-control';
  button.onclick = event => { event.preventDefault(); run(event); };
  return { button, label: (value: string) => { if (text.textContent !== value) text.setText(value); }, icon: (value: string) => {
    if (value === icon) return; icon = value; setIcon(mark, value);
    if (!button.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) mark.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
  } };
}
// Read-along highlight: the sentence, the part already spoken, and the current word, drawn with
// the CSS Custom Highlight API so article DOM, selection and translation are never touched.
type HighlightHost = { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...ranges: Range[]) => unknown };
const LAYERS = ['qrs-sentence', 'qrs-spoken', 'qrs-word'] as const;
function paint(win: HighlightHost | null | undefined, layers: Partial<Record<typeof LAYERS[number], Range | null>>) {
  const registry = win?.CSS?.highlights, Highlight = win?.Highlight;
  if (!registry || !Highlight) return false;
  for (const name of LAYERS) { const range = layers[name]; if (range) registry.set(name, new Highlight(range)); else registry.delete(name); }
  return true;
}
type Session = { view: ReaderView; owner: SpeechOwner; items: ArticleSpeechItem[]; fingerprint: string; key: string; selection: boolean; fromHere: boolean; range?: Range; progress: number; follow: boolean; bar?: HTMLElement; highlighted?: HTMLElement; painted?: boolean; unwatch?: () => void; programmatic: number; render?: () => void };
// Adapter exposes exactly the host contract shared with Audio; RSS state remains owned by RSS.
export class RssSpeech {
  readonly speech: SpeechService;
  readonly voiceCatalogs: Record<string, VoiceCatalog> = {};
  private manager?: LocalManager;
  private unsubscribe: () => void;
  private progressTimer?: number;
  private session?: Session;
  private picker?: { close(): void };
  private actions = new Map<ReaderView, HTMLButtonElement>();
  private closing = new Map<ReaderView, { bar: HTMLElement; timer: number }>();
  private previewOwner: SpeechOwner = {};
  readonly app;
  readonly manifest;
  readonly reading = { restartWithSettings: () => this.restart() };
  constructor(readonly plugin: QiaomuRssPlugin) {
    this.app = plugin.app; this.manifest = plugin.manifest;
    this.settings.tts = mobileSpeechSettings(normalizeSettings({ tts: this.settings.tts }, Platform.isDesktopApp).tts, Platform.isDesktopApp);
    this.speech = new SpeechService(this);
    this.unsubscribe = this.speech.subscribe(() => { this.checkpoint(); this.session?.render?.(); this.renderActions(); });
  }
  get settings(): { tts: SpeechSettings } { return this.plugin.state.settings; }
  updateHighlightAppearance() {
    const prose = this.session?.view.speechContext()?.prose;
    if (prose) applyHighlightAppearance(prose, this.plugin.state.settings.speechHighlight);
  }
  saveSettings() { return this.plugin.persist(); }
  local() {
    if (!this.manager) { const path = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.(); this.manager = createLocalTtsManager({ vaultPaths: path ? [path] : [] }); }
    return this.manager;
  }
  private checkpoint() {
    const session = this.session, c = this.speech.controller;
    if (!session || session.selection || c.owner !== session.owner || !['playing', 'paused', 'ended'].includes(c.state)) return;
    const item = session.items[c.index];
    rememberProgress(this.plugin.state.speechProgress, session.key, session.fingerprint, item?.start || 0, c.state === 'ended');
    if (this.progressTimer) window.clearTimeout(this.progressTimer);
    this.progressTimer = window.setTimeout(() => { this.progressTimer = undefined; void this.plugin.persist().catch(() => new Notice(t('notice.cannotSaveSettings'))); }, 600);
  }
  attach(view: ReaderView, toolbar: HTMLElement) {
    let selection: Range | undefined;
    const slot = toolbar.createDiv('qrs-speech-slot');
    const read = speechButton(slot, 'play', t('speech.read'), () => {
      if (selection && !sameSpeechRange(selection, this.session?.range)) this.start(view, selection); else if (this.session?.view === view) this.toggle(); else this.start(view);
      selection = undefined;
    });
    read.button.addClass('qrs-icon');
    read.button.dataset.qrsTip = 'speech';
    if (!this.actions.has(view)) view.register(() => this.actions.delete(view));
    this.actions.set(view, read.button); this.renderActions();
    if (this.session?.view === view && this.session.bar) slot.append(this.session.bar);
    read.button.onpointerdown = () => {
      selection = articleSelection(view.speechContext()?.prose);
    };
  }
  private renderActions() {
    const c = this.speech.controller;
    for (const [view, button] of this.actions) {
      const current = this.session?.view === view && c.owner === this.session.owner;
      const active = current && c.state === 'playing';
      button.toggleClass('is-playing', active); button.setAttribute('aria-pressed', String(active));
      const label = active ? t('speech.pause') : current && c.state === 'paused' ? t('speech.play') : t('speech.read');
      const text = button.querySelector('.qrs-visually-hidden'); if (text?.textContent !== label) text?.setText(label);
    }
  }
  start(view: ReaderView, selectedRange?: Range, fromStart = false, toEnd = false) {
    const context = view.speechContext();
    if (!context?.prose || context.loading) { new Notice(t('speech.empty')); return; }
    if (this.needsSetup()) {
      const identity = [context.id, context.mode].join(':');
      this.plugin.openSpeechSettings(() => { const current = view.speechContext(); if (current && [current.id, current.mode].join(':') === identity) this.start(view, selectedRange, fromStart, toEnd); });
      return;
    }
    const range = selectedRange?.cloneRange();
    if (range && toEnd) range.setEnd(context.prose, context.prose.childNodes.length);
    const { limit, clauses } = this.speech.chunking(), source = articleSpeechSource(context.prose, limit, clauses, range);
    if (!source.items.length) { new Notice(t('speech.empty')); return; }
    const items = source.items;
    if (!items.length) return;
    const profile = this.speech.profile(), problem = this.speech.configurationError(profile);
    if (problem) { new Notice(speechError(problem)); this.plugin.openSpeechSettings(() => { if (view.speechContext()?.prose === context.prose) this.start(view, selectedRange, fromStart, toEnd); }); return; }
    this.stop();
    // Pause source media before narration; ordinary media never starts automatically here.
    for (const media of view.contentEl.querySelectorAll<HTMLMediaElement>('audio,video')) media.pause();
    const key = JSON.stringify([context.id, context.mode]);
    const offset = selectedRange || fromStart ? 0 : resumeOffset(this.plugin.state.speechProgress, key, source.fingerprint);
    const index = Math.max(0, items.findIndex(item => item.end > offset));
    const session: Session = { view, items, fingerprint: source.fingerprint, key, selection: !!selectedRange, fromHere: toEnd, range: range?.cloneRange(), progress: 0, follow: true, programmatic: 0, owner: {} };
    const win = context.prose.ownerDocument.defaultView!;
    session.owner = { clearHighlight: () => { session.highlighted?.removeClass('qrs-speaking'); session.highlighted = undefined; if (session.painted) { paint(win, {}); session.painted = false; } }, onSegment: (_item, position) => {
      if (this.session !== session) return;
      if (!context.prose?.isConnected) { this.stop(); return; }
      session.owner.clearHighlight?.();
      const item = items[position], sentence = item.range?.(0, item.text.length) ?? null;
      // A selection must never fall back to painting unselected surrounding prose.
      if (sentence && paint(win, { 'qrs-sentence': sentence })) session.painted = true;
      else if (!session.selection) { session.highlighted = item.block; item.block.addClass('qrs-speaking'); }
      session.progress = this.fraction(session, position, 0); session.render?.();
      if (session.follow) this.reveal(session, sentence ?? item.block);
    }, onProgress: (item, position, word) => {
      const entry = items[position];
      if (this.session !== session || !entry || entry !== item) return;
      session.progress = this.fraction(session, position, word?.end || 0); session.render?.();
      if (!session.painted || !entry.range) return;
      const sentence = entry.range(0, entry.text.length);
      if (!word) { paint(win, { 'qrs-sentence': sentence }); return; }
      paint(win, { 'qrs-sentence': sentence, 'qrs-spoken': word.start > 0 ? entry.range(0, word.start) : null, 'qrs-word': entry.range(word.start, word.end) });
      const range = entry.range(word.start, word.end);
      if (session.follow && range) this.reveal(session, range);
    } };
    this.session = session; this.updateHighlightAppearance(); this.mount(session);
    const Observer = (win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
    const observer = new Observer(() => this.updateHighlightAppearance());
    observer.observe(context.prose.ownerDocument.body, { attributes: true, attributeFilter: ['class', 'style'] });
    observer.observe(view.contentEl, { attributes: true, attributeFilter: ['data-qrs-theme'] });
    const unwatch = session.unwatch;
    session.unwatch = () => { unwatch?.(); observer.disconnect(); };
    this.speech.controller.makeAudio = () => new (win as unknown as { Audio: typeof Audio }).Audio();
    this.speech.controller.start(session.owner, items, profile, { index, rate: this.settings.tts.rate });
  }
  private reveal(session: Session, target: HTMLElement | Range) {
    // Popout windows have their own Range/HTMLElement constructors, so test shape, not class.
    const isRange = (value: HTMLElement | Range): value is Range => 'commonAncestorContainer' in value;
    const common = isRange(target) ? target.commonAncestorContainer : target;
    const block = common.nodeType === 1 ? common as HTMLElement : common.parentElement;
    const reader = block?.closest<HTMLElement>('.qrs-reader');
    const bounds = reader?.getBoundingClientRect(), rect = target.getBoundingClientRect();
    if (!block || !bounds || !(rect.top < bounds.top + (reader?.querySelector('.qrs-reader-head')?.getBoundingClientRect().height || 44) + 12 || rect.bottom > bounds.bottom - 16)) return;
    session.programmatic = Date.now();
    // Keep a long paragraph's current line in view, not just its first one.
    if (isRange(target)) reader!.scrollBy({ top: rect.top - bounds.top - bounds.height * 0.4, behavior: 'instant' });
    else block.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  needsSetup() {
    const settings = this.settings.tts;
    return this.plugin.state.settings.speechSetupPending || !settings.welcomed && !Object.keys(settings.profiles).length && !Object.keys(this.plugin.state.speechProgress).length && ['edge', 'system'].includes(settings.provider);
  }
  private fraction(session: Session, index: number, chars: number) {
    const total = session.items.reduce((sum, item) => sum + item.text.length, 0);
    const read = session.items.slice(0, index).reduce((sum, item) => sum + item.text.length, 0) + chars;
    return Math.max(0, Math.min(1, read / Math.max(1, total)));
  }
  private mount(session: Session) {
    this.finishClosing(session.view);
    const parent = this.actions.get(session.view)!.parentElement!;
    const bar = session.bar = parent.createDiv({ cls: 'qrs-speech-bar is-opening', attr: { role: 'region' } });
    const label = bar.createSpan({ cls: 'qrs-visually-hidden', text: t('speech.read'), attr: { id: `qrs-speech-${crypto.randomUUID()}` } }); bar.setAttribute('aria-labelledby', label.id);
    const row = bar.createDiv('qrs-speech-row');
    let playbackSelection: Range | undefined;
    const play = speechButton(row, 'pause', t('speech.pause'), () => {
      const c = this.speech.controller;
      const range = playbackSelection || articleSelection(session.view.speechContext()?.prose);
      playbackSelection = undefined;
      if (!['playing', 'loading'].includes(c.state) && range && !sameSpeechRange(range, session.range)) this.start(session.view, range);
      else this.toggle();
    });
    play.button.onpointerdown = () => { playbackSelection = articleSelection(session.view.speechContext()?.prose); };
    play.button.addClass('qrs-speech-primary');
    const ring = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('class', 'qrs-speech-ring'); ring.setAttribute('viewBox', '0 0 36 36'); ring.setAttribute('aria-hidden', 'true');
    for (const name of ['track', 'value']) {
      const circle = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [key, value] of Object.entries({ cx: '18', cy: '18', r: '15', pathLength: '100', class: `qrs-speech-ring-${name}` })) circle.setAttribute(key, value);
      ring.append(circle);
    }
    play.button.prepend(ring);
    const progress = bar.createSpan({ cls: 'qrs-visually-hidden qrs-speech-progress', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-labelledby': label.id } });
    const message = row.createDiv({ cls: 'qrs-speech-message qrs-visually-hidden', attr: { role: 'status', 'aria-live': 'polite' } });
    const speed = row.createEl('button', { cls: 'qrs-speech-button qrs-speech-speed', });
    speed.dataset.qrsTip = 'speech-speed';
    speed.createSpan({ cls: 'qrs-visually-hidden', text: t('speech.speed') });
    const speedValue = speed.createSpan({ text: `${this.settings.tts.rate}×` });
    speed.onclick = () => this.rateMenu(speed);
    let selected: Range | undefined;
    const more = speechButton(row, 'ellipsis', t('speech.more'), () => {
      const range = selected || articleSelection(session.view.speechContext()?.prose);
      if (bar.ownerDocument.defaultView!.getComputedStyle(bar).getPropertyValue('--qrs-speech-compact').trim() === '1') {
        this.openCompactMenu(session.view, more.button, range); selected = undefined; return;
      }
      const menu = new Menu().setUseNativeMenu(false);
      const navigation = (target: Menu) => {
        target.addItem(item => item.setTitle(t('speech.fromStart')).setIcon('rotate-ccw').onClick(() => this.start(session.view, undefined, true)));
        if (range) target.addItem(item => item.setTitle(t('speech.fromHere')).setIcon('text-cursor-input').onClick(() => this.start(session.view, range, true, true)));
        if (!session.follow) target.addItem(item => item.setTitle(t('speech.follow')).setIcon('locate-fixed').onClick(() => { session.follow = true; const item = session.items[this.speech.controller.index]; if (item) this.reveal(session, item.range?.(0, item.text.length) ?? item.block); }));
      };
      if (!session.follow) menu.addItem(item => item.setTitle(t('speech.position')).setIcon('locate-fixed').onClick(() => { const next = new Menu().setUseNativeMenu(false); navigation(next); const rect = more.button.getBoundingClientRect(); next.showAtPosition({ x: rect.left, y: rect.bottom }); }));
      else navigation(menu);
      menu.addItem(item => item.setTitle(t('speech.soundSettings')).setIcon('audio-lines').onClick(() => this.openSettings()));
      const rect = more.button.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }); selected = undefined;
    });
    more.button.addClass('qrs-speech-more');
    more.button.onpointerdown = () => { selected = articleSelection(session.view.speechContext()?.prose); };
    speechButton(row, 'x', t('speech.close'), () => this.stop(true)).button.addClass('qrs-speech-close');
    const away = () => { if (Date.now() - session.programmatic > 400) session.follow = false; };
    session.view.contentEl.addEventListener('wheel', away, { passive: true }); session.view.contentEl.addEventListener('touchmove', away, { passive: true });
    session.unwatch = () => { session.view.contentEl.removeEventListener('wheel', away); session.view.contentEl.removeEventListener('touchmove', away); };
    session.render = () => {
      const c = this.speech.controller, active = c.owner === session.owner, busy = active && ['playing', 'loading'].includes(c.state);
      const newSelection = !busy && !!articleSelection(session.view.speechContext()?.prose) && !sameSpeechRange(articleSelection(session.view.speechContext()?.prose), session.range);
      play.icon(newSelection ? 'play' : c.state === 'ended' ? 'rotate-ccw' : busy ? 'pause' : 'play'); play.label(t(newSelection ? 'speech.selection' : c.state === 'ended' ? 'speech.replay' : busy ? 'speech.pause' : 'speech.play'));
      speedValue.setText(`${this.settings.tts.rate}×`);
      const text = !active ? t('speech.pause') : c.state === 'error' ? speechError(c.error) : c.state === 'loading' ? t('speech.loading') : c.state === 'ended' ? t('speech.complete') : t(session.fromHere ? 'speech.fromHere' : session.selection ? 'speech.selectionMode' : 'speech.fullMode');
      if (message.textContent !== text) message.setText(text);
      message.toggleClass('is-error', active && c.state === 'error');
      message.toggleClass('qrs-visually-hidden', !(active && c.state === 'error'));
      const fraction = c.state === 'ended' && active ? 1 : session.progress;
      bar.setCssProps({ '--qrs-speech-progress': String(100 * (1 - fraction)) });
      progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      bar.dataset.state = active ? c.state : 'paused';
      bar.classList.toggle('has-error', active && c.state === 'error');
    };
    const doc = parent.ownerDocument, selectionChanged = () => session.render?.();
    doc.addEventListener('selectionchange', selectionChanged);
    const unwatch = session.unwatch;
    session.unwatch = () => { unwatch?.(); doc.removeEventListener('selectionchange', selectionChanged); };
    const opened = (event: AnimationEvent) => {
      if (event.animationName !== 'qrs-speech-controls-in') return;
      bar.removeClass('is-opening'); bar.removeEventListener('animationend', opened);
    };
    bar.addEventListener('animationend', opened);
    if (doc.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches) bar.removeClass('is-opening');
    session.render();
  }
  private showMenu(menu: Menu, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }
  private rateMenu(anchor: HTMLElement) {
    const menu = new Menu().setUseNativeMenu(false);
    for (const rate of [0.75, 1, 1.25, 1.5]) menu.addItem(item => item.setTitle(`${rate}×`).setChecked(rate === this.settings.tts.rate).onClick(() => {
      this.settings.tts.rate = rate; this.speech.controller.setRate(rate); void this.saveSettings();
    }));
    this.showMenu(menu, anchor);
  }
  openCompactMenu(view: ReaderView, anchor: HTMLElement, selected?: Range) {
    const session = this.session?.view === view ? this.session : undefined;
    const range = selected || articleSelection(view.speechContext()?.prose);
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem(item => item.setTitle(t('speech.playOptions')).setIcon('sliders-horizontal').onClick(() => {
      const next = new Menu().setUseNativeMenu(false);
      next.addItem(item => item.setTitle(`${t('speech.speed')} · ${this.settings.tts.rate}×`).setIcon('gauge').onClick(() => this.rateMenu(anchor)));
      next.addItem(item => item.setTitle(t('speech.fromStart')).setIcon('rotate-ccw').onClick(() => this.start(view, undefined, true)));
      if (range) next.addItem(item => item.setTitle(t('speech.fromHere')).setIcon('text-cursor-input').onClick(() => this.start(view, range, true, true)));
      if (session && !session.follow) next.addItem(item => item.setTitle(t('speech.follow')).setIcon('locate-fixed').onClick(() => {
        session.follow = true; const item = session.items[this.speech.controller.index]; if (item) this.reveal(session, item.range?.(0, item.text.length) ?? item.block);
      }));
      this.showMenu(next, anchor);
    }));
    menu.addItem(item => item.setTitle(t('speech.soundSettings')).setIcon('audio-lines').onClick(() => this.openSettings()));
    menu.addItem(item => item.setTitle(t('speech.articleActions')).setIcon('file-text').onClick(() => {
      const next = new Menu().setUseNativeMenu(false), actions = view.contentEl.querySelector('.qrs-actions')!;
      for (const [selector, icon] of [['[data-qrs-tip="favorite"]', 'bookmark'], ['[data-qrs-tip="read"]', 'circle-check'], ['[data-qrs-tip="daily-note"]', 'notebook-pen']]) {
        const button = actions.querySelector<HTMLButtonElement>(selector);
        if (button) next.addItem(item => item.setTitle(button.querySelector('.qrs-visually-hidden')?.textContent || '').setIcon(icon).onClick(() => button.click()));
      }
      next.addItem(item => item.setTitle(t('reader.moreActions')).setIcon('ellipsis').onClick(() => view.openArticleActions?.(anchor)));
      this.showMenu(next, anchor);
    }));
    if (session) menu.addItem(item => item.setTitle(t('speech.close')).setIcon('square').onClick(() => this.stop(true)));
    this.showMenu(menu, anchor);
  }
  voiceMenu() {
    this.picker?.close();
    this.picker = openVoicePicker(this, { onSettings: () => this.openSettings(), tx: speechChoiceText, chinese: /^zh/.test(locale()), onChange: async () => { await this.saveSettings(); this.restart(); }, errorText: speechError });
  }
  private toggle() { this.speech.stopPreview(); const c = this.speech.controller; if (c.state === 'ended') c.index = 0; c.toggle(); }
  restart() {
    this.speech.controller.cache.clear(); const session = this.session, c = this.speech.controller;
    if (!session || c.owner !== session.owner) return;
    const profile = this.speech.profile(), problem = this.speech.configurationError(profile);
    if (problem) { c.pause(); new Notice(speechError(problem)); return; }
    this.speech.controller.start(session.owner, session.items, profile, { index: Math.min(c.index, session.items.length - 1), rate: this.settings.tts.rate, paused: c.state === 'paused' });
  }
  suspendForSettings() {
    const session = this.session, controller = this.speech.controller;
    const resume = !!session && controller.owner === session.owner && ['playing', 'loading'].includes(controller.state);
    if (session && controller.owner === session.owner) controller.pause();
    return () => {
      this.speech.stopPreview();
      if (session && this.session === session && controller.owner === session.owner) {
        this.restart();
        if (resume && controller.state === 'paused') controller.toggle();
      }
    };
  }
  stopPreview() { this.speech.stopPreview(this.previewOwner); }
  preview() { const problem = this.speech.configurationError(); if (problem) throw problem instanceof Error ? problem : Object.assign(new Error(speechError(problem)), typeof problem === 'object' ? problem : {}); this.speech.startPreview(this.previewOwner, t('speech.sample')); }
  previewState() { const c = this.speech.controller; return c.owner === this.previewOwner ? c.state : 'idle'; }
  detach(view: ReaderView) { if (this.session?.view === view) this.stop(); }
  private finishClosing(view: ReaderView) {
    const closing = this.closing.get(view); if (!closing) return;
    closing.bar.ownerDocument.defaultView?.clearTimeout(closing.timer); const actions = closing.bar.closest('.qrs-actions'), win = closing.bar.ownerDocument.defaultView!;
    const compact = win.getComputedStyle(closing.bar).getPropertyValue('--qrs-speech-compact').trim() === '1';
    closing.bar.parentElement?.removeClass('is-collapsing'); closing.bar.remove(); this.closing.delete(view);
    if (compact && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const button of actions?.querySelectorAll<HTMLElement>(':scope > .qrs-icon') || []) button.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    }
  }
  stop(animate = false) {
    this.checkpoint(); const session = this.session; this.session = undefined;
    if (!session) return;
    this.speech.discardPreview(session.owner); this.picker?.close(); this.speech.controller.stop(session.owner);
    session.owner.clearHighlight?.(); session.unwatch?.();
    const bar = session.bar, win = bar?.ownerDocument.defaultView;
    this.finishClosing(session.view);
    if (animate && bar && win && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const focused = bar.contains(bar.ownerDocument.activeElement);
      bar.inert = true; bar.removeClass('is-opening'); bar.addClass('is-closing');
      const icon = bar.querySelector<HTMLElement>('.qrs-speech-primary > span[aria-hidden]');
      if (icon) { setIcon(icon, 'play'); icon.animate([{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' }); }
      bar.parentElement?.addClass('is-collapsing');
      const timer = win.setTimeout(() => { this.finishClosing(session.view); if (focused) this.actions.get(session.view)?.focus({ preventScroll: true }); }, 340);
      this.closing.set(session.view, { bar, timer });
    } else bar?.remove();
  }
  openSettings() { this.plugin.openSpeechSettings(); }
  dispose() { this.stop(); for (const view of this.closing.keys()) this.finishClosing(view); if (this.progressTimer) { window.clearTimeout(this.progressTimer); void this.plugin.persist(); } this.unsubscribe(); this.speech.dispose(); this.manager?.dispose(); this.actions.clear(); }
}

const choiceKeys: Record<string, MessageKey> = { service: 'speech.service', system: 'speech.system', macos: 'speech.macos', localModel: 'speech.local', settings: 'speech.title', automatic: 'speech.automatic', model: 'speech.model', resource: 'speech.resource', voice: 'speech.voice', picker: 'speech.picker', search: 'speech.search', custom: 'speech.custom', refresh: 'speech.refresh', loading: 'speech.loading', loaded: 'speech.loaded', partial: 'speech.partial', preview: 'speech.preview', sample: 'speech.sample', empty: 'speech.noVoices', verified: 'speech.verified', paused: 'speech.pause', macHelp: 'speech.macHelp', unavailable: 'speech.unavailable', recommended: 'speech.recommended', voicePremium: 'speech.premium', voiceEnhanced: 'speech.enhanced', voiceDisplayName: 'speech.displayName' };
export function speechChoiceText(key: string) { return t(choiceKeys[key]); }
