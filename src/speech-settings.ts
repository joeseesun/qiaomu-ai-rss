import { Modal, Notice, Platform, Setting } from 'obsidian';
import { SpeechChoices, TTS_PROVIDERS, hiddenProvider, modelKey, changeSpeechModel, normalizeLocalProfile, getSecret, setSecret, ttsSecretId, cloudService, LOCAL_MODELS, findSpeechSettings, copySpeechSettings } from '@qiaomu/speech/speech';
import type { LocalState, SpeechProfile } from '@qiaomu/speech/speech';
import type QiaomuRssPlugin from './main';
import { speechError, speechChoiceText } from './speech';
import { t, locale } from './i18n';
export class SpeechSettingsModal extends Modal {
  private cleanups: Array<() => void> = [];
  private revision = 0;
  constructor(private plugin: QiaomuRssPlugin) { super(plugin.app); }
  onOpen() { this.setTitle(t('speech.title')); this.contentEl.addClass('qrs-speech-settings'); this.render(); }
  onClose() { this.revision++; this.cleanup(); this.contentEl.empty(); }
  private cleanup() { this.plugin.speech.stopPreview(); for (const cleanup of this.cleanups) cleanup(); this.cleanups = []; }
  private async changed() { await this.plugin.persist(); this.plugin.speech.restart(); this.render(); }
  private render() {
    this.cleanup(); const revision = ++this.revision, root = this.contentEl; root.empty();
    const host = this.plugin.speech, settings = host.settings.tts, profile = host.speech.profile(), id = profile.id;
    root.createEl('p', { cls: 'qrs-speech-hint', text: t('speech.description') });
    const names: Record<string, 'speech.system' | 'speech.macos' | 'speech.local'> = { system: 'speech.system', macos: 'speech.macos', localModel: 'speech.local' };
    new Setting(root).setName(t('speech.service')).setDesc(t(['system','macos','localModel'].includes(id) ? 'speech.deviceHelp' : 'speech.cloudHelp')).addDropdown(drop => {
      for (const [provider, value] of Object.entries(TTS_PROVIDERS)) if (!hiddenProvider(provider, id)) drop.addOption(provider, names[provider] ? t(names[provider]) : value.label || provider);
      drop.setValue(id).onChange(async value => { settings.provider = value; await this.changed(); });
    });
    const update = async (key: keyof SpeechProfile, value: string) => {
      if (['baseUrl', 'region'].includes(key)) delete host.voiceCatalogs[id];
      let next = key === modelKey(profile) && id !== 'localModel' ? changeSpeechModel(profile, value, host.voiceCatalogs[id]) : { ...profile, [key]: value };
      if (id === 'localModel') next = normalizeLocalProfile(key === 'model' ? { ...next, voice: '' } : next);
      const { id: _id, label: _label, key: _key, ...saved } = next;
      settings.profiles[id] = saved; await this.changed();
    };
    if (!['system', 'edge', 'macos', 'localModel'].includes(id)) {
      const keyId = ttsSecretId(id, this.plugin.manifest.id), info = cloudService('tts', id);
      const key = new Setting(root).setName(t('speech.key')).addText(text => {
        text.inputEl.type = 'password'; text.setValue(getSecret(this.app, keyId)); text.inputEl.autocomplete = 'off';
        text.inputEl.addEventListener('change', () => { try { setSecret(this.app, keyId, text.getValue()); delete host.voiceCatalogs[id]; void this.changed(); } catch (error) { new Notice(speechError(error)); } });
      });
      if (info) { key.descEl.createEl('a', { text: t('speech.getKey'), href: info.keyHelp, attr: { target: '_blank', rel: 'noopener noreferrer' } }); if (info.docs) { key.descEl.appendText(' · '); key.descEl.createEl('a', { text: t('speech.docs'), href: info.docs, attr: { target: '_blank', rel: 'noopener noreferrer' } }); } }
    }
    const field = (parent: HTMLElement, name: string, key: keyof SpeechProfile) => new Setting(parent).setName(name).addText(text => { text.setValue(String(profile[key] || '')); text.inputEl.addEventListener('change', () => { void update(key, text.getValue().trim()); }); });
    if (id === 'azure') field(root, t('speech.region'), 'region');
    if (id === 'compatible') field(root, 'API URL', 'baseUrl');
    const picker = new SpeechChoices(root.createDiv(), { host, tx: speechChoiceText, chinese: /^zh/.test(locale()), onChange: async key => { await this.plugin.persist(); host.restart(); if (key !== 'voice') this.render(); }, errorText: speechError });
    this.cleanups.push(() => picker.destroy());
    if (id === 'localModel' && Platform.isDesktopApp) this.localPanel(root, profile.model || '', revision);
    const test = new Setting(root).setName(t('speech.preview')); test.settingEl.addClass('qrs-speech-preview');
    const status = test.descEl.createSpan({ text: t('speech.unverified'), attr: { role: 'status', 'aria-live': 'polite' } });
    test.addButton(button => button.setButtonText(t('speech.stop')).onClick(() => { host.stopPreview(); status.setText(t('speech.unverified')); }));
    test.addButton(button => button.setButtonText(t('speech.preview')).setCta().onClick(() => { try { host.preview(); } catch (error) { status.setText(speechError(error)); } }));
    this.cleanups.push(host.speech.subscribe(() => {
      const state = host.previewState(); if (state === 'idle') return;
      status.setText(state === 'ended' ? t('speech.verified') : state === 'error' ? speechError(host.speech.controller.error) : state === 'paused' ? t('speech.pause') : t('speech.loading')); status.toggleClass('is-error', state === 'error');
    }));
    const details = root.createEl('details', { cls: 'qrs-speech-details' }); details.createEl('summary', { text: t('speech.advanced') });
    if (profile.baseUrl !== undefined && id !== 'compatible') field(details, 'API URL', 'baseUrl');
    new Setting(details).setName(t('speech.fromStart')).addButton(button => button.setButtonText(t('speech.fromStart')).onClick(() => { const view = this.plugin.app.workspace.getActiveViewOfType(ReaderView); if (view) { this.close(); host.start(view, undefined, true); } }));
    void findSpeechSettings(this.app, 'qiaomu-audio').then(found => {
      if (!found || revision !== this.revision || !root.isConnected) return;
      new Setting(details).setName(t('speech.import')).setDesc(t('speech.importDesc')).addButton(button => button.setButtonText(t('speech.import')).onClick(async () => { const keys = await copySpeechSettings(host, 'qiaomu-audio'); if (keys >= 0) new Notice(t('speech.imported')); this.render(); })); this.labelInputs(root);
    });
    this.labelInputs(root);
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
import { ReaderView } from './view';
