import { Modal, Setting, type App } from 'obsidian';
import { VaultFolderPicker } from './vault-source';
import { articleFolderPath, availableNotePath } from './vault-export';
import { t } from './i18n';

export class NoteLocationModal extends Modal {
  constructor(app: App, private folder: string, private name: string,
    private save: (folder: string, remember: boolean) => Promise<void>) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('qrs-note-location');
    this.setTitle(t('reader.saveNoteTo'));
    let remember = false, saving = false;
    const location = new Setting(this.contentEl).setName(t('settings.articleFolder.name')).setDesc(t('note.folderHint'));
    location.nameEl.id = `qrs-note-folder-${crypto.randomUUID()}`;
    const preview = this.contentEl.createEl('p', { cls: 'qrs-note-path' });
    const error = this.contentEl.createEl('p', { cls: 'qrs-subscription-error', attr: { role: 'alert' } });
    const updatePreview = () => {
      try {
        preview.setText(availableNotePath(path => !!this.app.vault.getAbstractFileByPath(path), articleFolderPath(this.folder), this.name));
        error.setText('');
      } catch (e) { preview.setText(''); error.setText(e instanceof Error ? e.message : t('common.saveFailed')); }
    };
    location.addText(input => {
      input.setValue(this.folder).onChange(value => { this.folder = value; updatePreview(); });
      input.inputEl.setAttribute('aria-labelledby', location.nameEl.id);
      location.addButton(button => button.setButtonText(t('settings.choose')).onClick(() => {
        new VaultFolderPicker(this.app, folder => {
          this.folder = folder.path === '/' ? '' : folder.path;
          input.setValue(this.folder); updatePreview();
        }).open();
      }));
    });
    new Setting(this.contentEl).setName(t('note.rememberFolder')).addToggle(toggle => toggle.onChange(value => { remember = value; }));
    const actions = new Setting(this.contentEl);
    actions.addButton(button => button.setButtonText(t('common.cancel')).onClick(() => { if (!saving) this.close(); }));
    actions.addButton(button => button.setButtonText(t('common.save')).setCta().onClick(async () => {
      if (saving) return;
      saving = true; button.setDisabled(true);
      try { await this.save(articleFolderPath(this.folder), remember); this.close(); }
      catch (e) { error.setText(e instanceof Error ? e.message : t('common.saveFailedRetry')); }
      finally { saving = false; button.setDisabled(false); }
    }));
    updatePreview();
  }
  onClose(): void { this.contentEl.empty(); }
}
