import { FuzzySuggestModal, TFile, TFolder, type App } from 'obsidian';
import { safeUrl, type Bundle, type Entry } from './model';

export const vaultSourceId = (folder: string) => `@vault:${folder}`;
export function inFolder(path: string, folder: string): boolean {
  return folder === '/' || path.startsWith(folder + '/');
}
export class VaultFolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private choose: (folder: TFolder) => void) {
    super(app); this.setPlaceholder('搜索库内文件夹…');
  }
  getItems() { return this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder); }
  getItemText(folder: TFolder) { return folder.path === '/' ? '整个库' : folder.path; }
  onChooseItem(folder: TFolder) { this.choose(folder); }
}
export class VaultFilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private choose: (file: TFile) => void) { super(app); this.setPlaceholder('搜索库内笔记…'); }
  getItems() { return this.app.vault.getMarkdownFiles(); }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { this.choose(file); }
}
export class VaultSources {
  constructor(private app: App) {}
  entries(folder: string): Entry[] {
    const target = this.app.vault.getAbstractFileByPath(folder);
    if (target instanceof TFile && target.extension === 'md') return [this.entry(target, folder)];
    if (!(target instanceof TFolder)) throw new Error('文件夹不存在，请在设置中重新选择。');
    return this.app.vault.getMarkdownFiles().filter(file => inFolder(file.path, folder))
      .sort((a, b) => b.stat.mtime - a.stat.mtime).map(file => this.entry(file, folder));
  }
  private entry(file: TFile, folder: string): Entry {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const title = typeof frontmatter?.title === 'string' ? frontmatter.title : file.basename;
    const source = [frontmatter?.source, frontmatter?.url].find(value => typeof value === 'string' && safeUrl(value)) as string | undefined;
    return { id: 'vault:' + file.path, origin: 'vault', sourceId: vaultSourceId(folder), sourceName: folder === '/' ? '整个库' : folder,
      title, link: source || null, markdownPath: file.path, publishedTs: file.stat.mtime };
  }
  async article(entry: Entry): Promise<Bundle> {
    const file = this.app.vault.getAbstractFileByPath(entry.markdownPath || '');
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('Markdown 文件已移动或删除，请刷新列表。');
    const body = await this.app.vault.cachedRead(file);
    // Obsidian frontmatter is metadata, not article prose.
    const markdown = body.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    return { entry: { ...this.entry(file, entry.sourceId.slice(7)), markdown }, rewrite: null, translation: null, fetchedAt: Date.now() };
  }
}
