import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { openVoicePicker, SpeechService, createLocalTtsManager, normalizeSettings, RATES, rememberProgress, resumeOffset, splitSpeechText } from '@qiaomu/speech/speech';
import type { LocalManager, SpeechOwner, SpeechSettings, VoiceCatalog } from '@qiaomu/speech/speech';
import type QiaomuRssPlugin from './main';
import type { ReaderView } from './view';
import { t, locale, type MessageKey } from './i18n';
import { applyHighlightAppearance } from './speech-highlight';
import { articleSpeechSource, type ArticleSpeechItem } from './speech-source';
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
  button.onclick = event => { event.preventDefault(); run(event); };
  return { button, label: (value: string) => text.setText(value), icon: (value: string) => setIcon(mark, value) };
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
type Session = { view: ReaderView; owner: SpeechOwner; items: ArticleSpeechItem[]; fingerprint: string; key: string; selection: boolean; follow: boolean; bar?: HTMLElement; highlighted?: HTMLElement; painted?: boolean; unwatch?: () => void; programmatic: number; render?: () => void };
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
  private previewOwner: SpeechOwner = {};
  readonly app;
  readonly manifest;
  readonly reading = { restartWithSettings: () => this.restart() };
  constructor(readonly plugin: QiaomuRssPlugin) {
    this.app = plugin.app; this.manifest = plugin.manifest;
    this.settings.tts = normalizeSettings({ tts: this.settings.tts }, Platform.isDesktopApp).tts;
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
    let selection = '';
    const read = speechButton(toolbar, 'volume-2', t('speech.read'), () => {
      if (selection) this.start(view, selection); else if (this.session?.view === view) this.toggle(); else this.start(view);
      selection = '';
    });
    read.button.addClass('qrs-icon');
    if (!this.actions.has(view)) view.register(() => this.actions.delete(view));
    this.actions.set(view, read.button); this.renderActions();
    read.button.onpointerdown = () => {
      const selected = view.contentEl.ownerDocument.getSelection();
      const context = view.speechContext();
      selection = context?.prose && selected?.rangeCount && context.prose.contains(selected.anchorNode) && context.prose.contains(selected.focusNode) ? selected.toString().trim() : '';
    };
  }
  private renderActions() {
    const c = this.speech.controller;
    for (const [view, button] of this.actions) { const active = this.session?.view === view && c.owner === this.session.owner && c.state === 'playing'; button.toggleClass('is-playing', active); button.setAttribute('aria-pressed', String(active)); }
  }
  start(view: ReaderView, selectedText?: string, fromStart = false) {
    const context = view.speechContext();
    if (!context?.prose || context.loading) { new Notice(t('speech.empty')); return; }
    const { limit, clauses } = this.speech.chunking(), source = articleSpeechSource(context.prose, limit, clauses);
    if (!source.items.length) { new Notice(t('speech.empty')); return; }
    const items: ArticleSpeechItem[] = selectedText ? splitSpeechText(selectedText, limit, clauses).map(item => ({ ...item, block: context.prose! })) : source.items;
    if (!items.length) return;
    const profile = this.speech.profile(), problem = this.speech.configurationError(profile);
    if (problem) { new Notice(speechError(problem)); this.openSettings(); return; }
    this.stop();
    // Pause source media before narration; ordinary media never starts automatically here.
    for (const media of view.contentEl.querySelectorAll<HTMLMediaElement>('audio,video')) media.pause();
    const key = JSON.stringify([context.id, context.mode]);
    const offset = selectedText || fromStart ? 0 : resumeOffset(this.plugin.state.speechProgress, key, source.fingerprint);
    const index = Math.max(0, items.findIndex(item => item.end > offset));
    const session: Session = { view, items, fingerprint: source.fingerprint, key, selection: !!selectedText, follow: true, programmatic: 0, owner: {} };
    const win = context.prose.ownerDocument.defaultView!;
    session.owner = { clearHighlight: () => { session.highlighted?.removeClass('qrs-speaking'); session.highlighted = undefined; if (session.painted) { paint(win, {}); session.painted = false; } }, onSegment: (_item, position) => {
      if (this.session !== session) return;
      if (!context.prose?.isConnected) { this.stop(); return; }
      session.owner.clearHighlight?.();
      const item = items[position], sentence = item.range?.(0, item.text.length) ?? null;
      // Without a drawable range (selection, or no Highlight API) fall back to marking the paragraph.
      if (sentence && paint(win, { 'qrs-sentence': sentence })) session.painted = true;
      else { session.highlighted = item.block; item.block.addClass('qrs-speaking'); }
      if (session.follow) this.reveal(session, sentence ?? item.block);
    }, onProgress: (item, position, word) => {
      const entry = items[position];
      if (this.session !== session || !session.painted || !entry?.range || entry !== item) return;
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
    if (!block || !bounds || !(rect.top < bounds.top + 60 || rect.bottom > bounds.bottom - 85)) return;
    session.programmatic = Date.now();
    // Keep a long paragraph's current line in view, not just its first one.
    if (isRange(target)) reader!.scrollBy({ top: rect.top - bounds.top - bounds.height * 0.4, behavior: 'instant' });
    else block.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  private mount(session: Session) {
    const bar = session.bar = session.view.contentEl.createDiv({ cls: 'qrs-speech-bar', attr: { role: 'region' } });
    const label = bar.createSpan({ cls: 'qrs-visually-hidden', text: t('speech.read'), attr: { id: `qrs-speech-${crypto.randomUUID()}` } }); bar.setAttribute('aria-labelledby', label.id);
    const row = bar.createDiv('qrs-speech-row');
    speechButton(row, 'audio-lines', t('speech.voice'), () => this.voiceMenu());
    const previous = speechButton(row, 'skip-back', t('speech.previous'), () => this.speech.controller.skip(-1));
    const play = speechButton(row, 'pause', t('speech.pause'), () => this.toggle());
    const next = speechButton(row, 'skip-forward', t('speech.next'), () => this.speech.controller.skip(1));
    const speed = row.createEl('button', { cls: 'qrs-speech-button qrs-speech-speed', text: `${this.settings.tts.rate}×` });
    speed.onclick = event => { const menu = new Menu().setUseNativeMenu(false); for (const rate of RATES) menu.addItem(item => item.setTitle(`${rate}×`).setChecked(rate === this.settings.tts.rate).onClick(() => { this.settings.tts.rate = rate; this.speech.controller.setRate(rate); void this.saveSettings(); })); menu.showAtMouseEvent(event); };
    const follow = speechButton(row, 'locate-fixed', t('speech.follow'), () => { session.follow = true; const item = session.items[this.speech.controller.index]; if (item) this.reveal(session, item.range?.(0, item.text.length) ?? item.block); session.render?.(); });
    speechButton(row, 'settings', t('speech.title'), () => this.openSettings());
    speechButton(row, 'x', t('speech.close'), () => this.stop());
    const message = bar.createDiv({ cls: 'qrs-speech-message', attr: { role: 'status', 'aria-live': 'polite' } });
    const away = () => { if (Date.now() - session.programmatic > 400) { session.follow = false; session.render?.(); } };
    session.view.contentEl.addEventListener('wheel', away, { passive: true }); session.view.contentEl.addEventListener('touchmove', away, { passive: true });
    session.unwatch = () => { session.view.contentEl.removeEventListener('wheel', away); session.view.contentEl.removeEventListener('touchmove', away); };
    session.render = () => {
      const c = this.speech.controller, active = c.owner === session.owner, busy = active && ['playing', 'loading'].includes(c.state);
      play.icon(busy ? 'pause' : 'play'); play.label(t(busy ? 'speech.pause' : 'speech.play'));
      speed.setText(`${this.settings.tts.rate}×`); follow.button.hidden = session.follow;
      previous.button.disabled = next.button.disabled = !active;
      message.setText(!active ? '' : c.state === 'error' ? speechError(c.error) : c.state === 'loading' ? t('speech.loading') : c.state === 'ended' ? t('speech.complete') : `${Math.min(c.index + 1, session.items.length)} / ${session.items.length}`);
      message.toggleClass('is-error', active && c.state === 'error');
    };
  }
  private voiceMenu() {
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
  stopPreview() { this.speech.stopPreview(this.previewOwner); }
  preview() { const problem = this.speech.configurationError(); if (problem) throw problem instanceof Error ? problem : new Error(speechError(problem)); this.speech.startPreview(this.previewOwner, t('speech.sample')); }
  previewState() { const c = this.speech.controller; return c.owner === this.previewOwner ? c.state : 'idle'; }
  detach(view: ReaderView) { if (this.session?.view === view) this.stop(); }
  stop() { this.checkpoint(); const session = this.session; this.session = undefined; if (session) { this.speech.discardPreview(session.owner); this.picker?.close(); this.speech.controller.stop(session.owner); session.owner.clearHighlight?.(); session.unwatch?.(); session.bar?.remove(); } }
  openSettings() { this.plugin.openSpeechSettings(); }
  dispose() { this.stop(); if (this.progressTimer) { window.clearTimeout(this.progressTimer); void this.plugin.persist(); } this.unsubscribe(); this.speech.dispose(); this.manager?.dispose(); this.actions.clear(); }
}

const choiceKeys: Record<string, MessageKey> = { service: 'speech.service', system: 'speech.system', macos: 'speech.macos', localModel: 'speech.local', settings: 'speech.title', automatic: 'speech.automatic', model: 'speech.model', resource: 'speech.resource', voice: 'speech.voice', picker: 'speech.picker', search: 'speech.search', custom: 'speech.custom', refresh: 'speech.refresh', loading: 'speech.loading', loaded: 'speech.loaded', partial: 'speech.partial', preview: 'speech.preview', sample: 'speech.sample', empty: 'speech.noVoices', verified: 'speech.verified', paused: 'speech.pause', macHelp: 'speech.macHelp', unavailable: 'speech.unavailable', recommended: 'speech.recommended', voicePremium: 'speech.premium', voiceEnhanced: 'speech.enhanced', voiceDisplayName: 'speech.displayName' };
export function speechChoiceText(key: string) { return t(choiceKeys[key]); }
