import { Modal, Notice, Platform, Setting } from 'obsidian';
import { SpeechChoices, TTS_PROVIDERS, hiddenProvider, modelKey, changeSpeechModel, getSecret, setSecret, ttsSecretId, cloudService, ttsProfile, LOCAL_MODELS, findSpeechSettings, copySpeechSettings } from '@qiaomu/speech/speech';
import type { LocalState, SpeechProfile } from '@qiaomu/speech/speech';
import type QiaomuRssPlugin from './main';
import { speechError, speechChoiceText } from './speech';
import { DEFAULT_HIGHLIGHT, applyHighlightAppearance, type SpeechHighlight } from './speech-highlight';
import { t, locale } from './i18n';
import { preferredMacVoices, voiceMarker } from './speech-voices';
import { mobileSpeechSettings } from './speech-platform';
export class SpeechSettingsModal extends Modal {
  private cleanups: Array<() => void> = [];
  private revision = 0;
  private page: 'home' | 'services' | 'config' = 'home';
  private verified = '';
  private previewIdentity = '';
  private fresh: boolean;
  private restore?: () => void;
  private abort = new AbortController();
  private status?: HTMLElement;
  constructor(private plugin: QiaomuRssPlugin, private onReady?: () => void) { super(plugin.app); this.fresh = plugin.speech.needsSetup(); }
  onOpen() {
    this.setTitle(t('speech.soundSettings')); this.modalEl.addClass('qrs-modal');
    this.contentEl.addClass('qaudio-modal', 'qrs-speech-settings');
    this.restore = this.plugin.speech.suspendForSettings();
    this.contentEl.createEl('p', { text: t('speech.loading'), attr: { role: 'status' } });
    void this.initialize();
  }
  private async initialize() {
    const host = this.plugin.speech, settings = host.settings.tts;
    if (this.fresh) this.plugin.state.settings.speechSetupPending = true;
    try {
      if (Platform.isDesktopApp && Platform.isMacOS) {
        const catalog = await host.speech.loadChoices(ttsProfile(settings, 'macos'), { signal: this.abort.signal, chinese: /^zh/.test(locale()), tx: voiceMarker });
        if (this.abort.signal.aborted) return;
        catalog.voices = preferredMacVoices(catalog.voices || [], locale(), speechChoiceText);
        host.voiceCatalogs.macos = catalog;
        if (this.fresh && catalog.voices.length) {
          settings.provider = 'macos'; settings.profiles.macos = { voice: catalog.voices[0].id };
          await this.plugin.persist();
        }
      } else if (this.fresh && window.speechSynthesis?.getVoices().length) settings.provider = 'system';
    } catch { /* A failed native discovery still leaves cloud/local setup available. */ }
    if (this.abort.signal.aborted) return;
    if (this.fresh && !((settings.provider === 'macos' && host.voiceCatalogs.macos?.voices?.length) || (settings.provider === 'system' && window.speechSynthesis?.getVoices().length))) this.page = 'services';
    this.render();
  }
  onClose() { this.abort.abort(); this.revision++; this.cleanup(); this.restore?.(); this.contentEl.empty(); }
  private cleanup() { for (const cleanup of this.cleanups) cleanup(); this.cleanups = []; this.plugin.speech.speech.stopPreview(); }
  private identity() { const profile = this.plugin.speech.speech.profile(); return JSON.stringify(profile); }
  private async changed() { this.verified = ''; await this.plugin.persist(); this.render(); }
  private action(parent: HTMLElement, label: string, run: () => void | Promise<void>, primary = false) {
    const button = parent.createEl('button', { text: label, cls: primary ? 'mod-cta' : '', attr: { type: 'button' } });
    button.onclick = () => { void Promise.resolve().then(run).catch(error => { this.status?.setText(speechError(error)); }); };
    return button;
  }
  private render() {
    this.cleanup(); const revision = ++this.revision, root = this.contentEl; root.empty();
    const host = this.plugin.speech, settings = host.settings.tts, profile = host.speech.profile(), id = profile.id;
    this.status = root.createEl('p', { cls: 'qrs-speech-hint', text: this.verified === this.identity() ? t('speech.verified') : t('speech.unverified'), attr: { role: 'status', 'aria-live': 'polite' } });
    let refresh = () => {};
    if (this.page === 'services') {
      this.status.setText(t('speech.chooseService'));
      const names: Record<string, 'speech.system' | 'speech.macos' | 'speech.local'> = { system: 'speech.system', macos: 'speech.macos', localModel: 'speech.local' };
      let selected = id;
      new Setting(root).setName(t('speech.service')).addDropdown(drop => {
        for (const [provider, value] of Object.entries(TTS_PROVIDERS)) if (!hiddenProvider(provider, id)) drop.addOption(provider, names[provider] ? t(names[provider]) : value.label || provider);
        drop.setValue(id).onChange(value => { selected = value; });
      });
      const imports = root.createDiv();
      void findSpeechSettings(this.app, 'qiaomu-audio').then(found => {
        if (!found || revision !== this.revision || this.abort.signal.aborted) return;
        this.action(imports, t('speech.import'), async () => { await copySpeechSettings(host, 'qiaomu-audio'); host.settings.tts = mobileSpeechSettings(host.settings.tts, Platform.isDesktopApp); await this.plugin.persist(); if (this.abort.signal.aborted) return; this.verified = ''; this.page = 'home'; this.render(); });
      }).catch(() => { /* Audio import is optional; RSS remains standalone. */ });
      const actions = root.createDiv('qrs-speech-setup-actions');
      this.action(actions, t('speech.back'), () => { this.page = 'home'; this.render(); });
      this.action(actions, t('speech.nextStep'), async () => {
        settings.provider = selected; this.verified = ''; await this.plugin.persist(); this.page = 'config'; this.render();
      }, true);
    } else {
      if (this.page === 'home') {
        const voices = host.speech.choices(profile, { chinese: /^zh/.test(locale()), tx: speechChoiceText });
        new Setting(root).setName(t('speech.voice')).setDesc(id === 'macos' ? t('speech.macQualityHelp') : t(['system', 'localModel'].includes(id) ? 'speech.deviceHelp' : 'speech.cloudHelp')).addDropdown(drop => {
          if (!voices.some(voice => voice.id === profile.voice)) drop.addOption(profile.voice, profile.voice || t('speech.automatic'));
          for (const voice of voices) drop.addOption(voice.id, voice.label);
          drop.setValue(profile.voice).onChange(async voice => { settings.profiles[id] = { ...settings.profiles[id], voice }; await this.changed(); });
        });
      } else {
        root.createEl('p', { cls: 'qrs-speech-hint', text: t(['system', 'macos', 'localModel'].includes(id) ? 'speech.deviceHelp' : 'speech.cloudHelp') });
        const update = async (key: keyof SpeechProfile, value: string) => {
          if (['baseUrl', 'region'].includes(key)) delete host.voiceCatalogs[id];
          const current = host.speech.profile();
          const next = key === modelKey(current) ? changeSpeechModel(current, value, host.voiceCatalogs[id]) : { ...current, [key]: value };
          const { id: _id, label: _label, key: _key, ...saved } = next;
          settings.profiles[id] = saved; this.verified = ''; await this.plugin.persist(); refresh();
        };
        if (!['system', 'edge', 'macos', 'localModel'].includes(id)) {
          const keyId = ttsSecretId(id, this.plugin.manifest.id), info = cloudService('tts', id);
          const row = new Setting(root).setName(t('speech.key')).addText(text => {
            text.inputEl.type = 'password'; text.setValue(getSecret(this.app, keyId)); text.inputEl.autocomplete = 'off';
            text.inputEl.addEventListener('change', () => { try { setSecret(this.app, keyId, text.getValue().trim()); delete host.voiceCatalogs[id]; this.verified = ''; refresh(); } catch (error) { this.status?.setText(speechError(error)); } });
          });
          if (info) row.descEl.createEl('a', { text: t('speech.getKey'), href: info.keyHelp, attr: { target: '_blank', rel: 'noopener noreferrer' } });
        }
        const field = (name: string, key: keyof SpeechProfile, parent = root) => new Setting(parent).setName(name).addText(text => {
          text.setValue(String(profile[key] || '')); text.inputEl.addEventListener('change', () => { void update(key, text.getValue().trim()).catch(() => new Notice(t('notice.cannotSaveSettings'))); });
        });
        if (id === 'azure') field(t('speech.region'), 'region');
        if (id === 'compatible') field('API URL', 'baseUrl');
        const picker = new SpeechChoices(root.createDiv(), { host, tx: speechChoiceText, chinese: /^zh/.test(locale()), onChange: async key => { this.verified = ''; await this.plugin.persist(); if (key === 'model' && id === 'localModel') this.render(); else refresh(); }, errorText: speechError });
        this.cleanups.push(() => picker.destroy());
        if (id === 'localModel' && Platform.isDesktopApp) this.localPanel(root, profile.model || '', revision);
        const details = root.createEl('details', { cls: 'qrs-speech-details' }); details.createEl('summary', { text: t('speech.advanced') });
        if (profile.baseUrl !== undefined && id !== 'compatible') field('API URL', 'baseUrl', details);
        this.appearance(details);
      }
      const actions = root.createDiv('qrs-speech-setup-actions');
      const preview = this.action(actions, t('speech.preview'), () => {
        if (['playing', 'loading'].includes(host.previewState())) { host.stopPreview(); return; }
        this.verified = ''; this.previewIdentity = this.identity(); host.preview();
      });
      this.action(actions, t(this.page === 'home' ? 'speech.serviceModel' : 'speech.back'), () => { this.page = 'services'; this.render(); });
      const done = this.action(actions, t(this.onReady ? 'speech.begin' : 'speech.done'), async () => {
        if ((this.fresh || this.onReady) && this.verified !== this.identity()) return;
        settings.welcomed = true; this.plugin.state.settings.speechSetupPending = false; await this.plugin.persist(); const ready = this.onReady; this.onReady = undefined; this.close(); ready?.();
      }, true);
      refresh = () => {
        if (revision !== this.revision) return;
        const state = host.previewState(), busy = ['playing', 'loading'].includes(state);
        if (state === 'ended' && this.previewIdentity === this.identity()) this.verified = this.previewIdentity;
        done.disabled = !!(this.fresh || this.onReady) && this.verified !== this.identity();
        preview.setText(t(busy ? 'speech.stop' : 'speech.preview'));
        this.status?.setText(state === 'error' ? speechError(host.speech.controller.error) : busy ? t('speech.loading') : this.verified === this.identity() ? t('speech.verified') : t('speech.unverified'));
        this.status?.toggleClass('is-error', state === 'error');
      };
      this.cleanups.push(host.speech.subscribe(refresh)); refresh();
    }
    this.labelInputs(root);
  }
  private appearance(root: HTMLElement) {
    const settings = this.plugin.state.settings.speechHighlight;
    new Setting(root).setName(t('speech.highlight')).setHeading();
    const styleRow = new Setting(root).setName(t('speech.highlightStyle'));
    const colorRow = new Setting(root).setName(t('speech.highlightColor'));
    const preview = root.createEl('p', { cls: 'qrs-speech-highlight-preview', attr: { 'aria-label': t('speech.highlightPreview') } });
    const sentence = preview.createSpan({ cls: 'qrs-speech-preview-sentence' });
    sentence.createSpan({ cls: 'qrs-speech-preview-word', text: t('speech.highlightWord') });
    sentence.appendText(t('speech.highlightSample'));
    const refresh = () => { applyHighlightAppearance(preview, settings); this.plugin.speech.updateHighlightAppearance(); };
    const save = () => { refresh(); void this.plugin.persist().catch(() => new Notice(t('notice.cannotSaveSettings'))); };
    let styleControl: import('obsidian').DropdownComponent;
    let colorControl: import('obsidian').ColorComponent;
    styleRow.addDropdown(drop => { styleControl = drop;
      for (const value of ['background', 'underline', 'sentence'] as const) drop.addOption(value, t(`speech.highlight.${value}`));
      drop.setValue(settings.style).onChange(value => { settings.style = value as SpeechHighlight['style']; save(); });
    });
    colorRow.addColorPicker(color => { colorControl = color; color.setValue(settings.color).onChange(value => { settings.color = value; save(); }); });
    colorRow.addButton(button => button.setButtonText(t('speech.highlightReset')).onClick(() => {
      Object.assign(settings, DEFAULT_HIGHLIGHT); styleControl.setValue(settings.style); colorControl.setValue(settings.color); save();
    }));
    const win = root.ownerDocument.defaultView!;
    const Observer = (win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
    const observer = new Observer(refresh); observer.observe(root.ownerDocument.body, { attributes: true, attributeFilter: ['class', 'style'] });
    this.cleanups.push(() => observer.disconnect()); refresh();
  }
  private labelInputs(root: HTMLElement) {
    for (const row of root.querySelectorAll('.setting-item')) {
      const label = row.querySelector<HTMLElement>('.setting-item-name'); if (!label) continue;
      label.id ||= `qrs-speech-field-${crypto.randomUUID()}`;
      for (const field of row.querySelectorAll('input,select')) { field.removeAttribute('aria-label'); field.removeAttribute('title'); field.setAttribute('aria-labelledby', label.id); }
    }
  }
  private localPanel(root: HTMLElement, model: string, revision: number) {
    const manager = this.plugin.speech.local(), info = LOCAL_MODELS.find(value => value.id === model);
    const panel = root.createDiv('qrs-speech-local'), status = panel.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    const progress = panel.createEl('progress', { attr: { max: '1' } });
    const actions = panel.createDiv('qrs-speech-local-actions');
    const download = actions.createEl('button', { text: t('speech.download') });
    download.onclick = () => { void manager.install(model).catch(error => { if (revision === this.revision) status.setText(speechError(error)); }); };
    const cancel = actions.createEl('button', { text: t('speech.cancel') }); cancel.onclick = () => manager.cancelInstall(model);
    const setup = actions.createEl('a', { text: t('speech.setup'), href: 'https://github.com/joeseesun/qiaomu-audio/blob/main/docs/local-runtime.md', attr: { target: '_blank', rel: 'noopener noreferrer' } });
    const check = actions.createEl('button', { text: t('speech.check') }); check.onclick = () => { void manager.status(model).catch(error => status.setText(speechError(error))); };
    const refresh = (state: LocalState) => {
      if (revision !== this.revision) return;
      const busy = ['runtime', 'download', 'downloaded', 'environment', 'extract', 'installed', 'verify', 'cancelling', 'server'].includes(state.phase), ready = state.phase === 'ready', missingRuntime = state.phase === 'runtimeMissing';
      status.setText(ready ? t('speech.ready') : missingRuntime ? t('speech.setup') : state.phase === 'error' ? speechError(state.error) : busy ? t('speech.loading') : `${info?.label || model} · ${Math.ceil((info?.bytes || 0) / 1024 ** 2)} MB`);
      download.hidden = ready || busy || missingRuntime; download.disabled = state.phase === 'unknown'; cancel.hidden = !busy; cancel.disabled = state.phase === 'cancelling'; setup.hidden = !missingRuntime; check.hidden = !missingRuntime; progress.hidden = !busy;
      if (state.total) progress.value = (state.bytes || 0) / state.total; else progress.removeAttribute('value');
    };
    this.cleanups.push(manager.subscribe((id, state) => { if (id === model) refresh(state); })); refresh(manager.snapshot(model));
    void manager.status(model).catch(error => { if (revision === this.revision) status.setText(speechError(error)); });
    const more = panel.createEl('details'); more.createEl('summary', { text: t('speech.sharedModels') });
    if (info) more.createEl('a', { text: `${info.label} · ${info.license}`, href: info.source, attr: { target: '_blank', rel: 'noopener noreferrer' } });
  }
}
