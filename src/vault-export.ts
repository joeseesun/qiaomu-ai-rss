import { normalizePath, TFolder, type App, type TFile } from 'obsidian';
import { articleExportBody, articleExportMarkdown, exportBaseName } from './article-export';
import { folderPath, type Bundle, type Mode } from './model';
import type { LocalImages } from './images';
import { fail } from './i18n';

const imageTypes: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };

/** An empty value or the picker root means the vault root, never an OS path. */
export function articleFolderPath(value: string): string {
  return !value.trim() || value.trim() === '/' ? '' : folderPath(value);
}

async function ensureFolder(app: App, folder: string) {
  let current = '';
  if (!folder) return;
  for (const segment of folder.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) fail('error.noteFolderOccupied');
    try { await app.vault.createFolder(current); }
    catch (error) { if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; }
  }
}

/** "<name>.md", then "<name> (2).md" … — saving the same article twice never overwrites the first note. */
export function availableNotePath(exists: (path: string) => boolean, folder: string, name: string): string {
  for (let n = 1; ; n++) {
    const path = normalizePath(`${folder && folder !== '/' ? `${folder}/` : ''}${name}${n > 1 ? ` (${n})` : ''}.md`);
    if (!exists(path)) return path;
  }
}

/** Replaces the placeholder image targets turndown wrote with the host-generated embed for each saved attachment. */
export function linkAttachments(markdown: string, links: Map<string, string>): string {
  return markdown.replace(/!\[(?:\\.|[^\]\\])*\]\((qrs-asset-\d+)(?: "(?:\\.|[^"\\])*")?\)/g, (match, token: string) => {
    const link = links.get(token); if (!link) return match;
    return link.startsWith('!') ? link : `!${link}`;
  });
}

// Saves into the vault through Obsidian's own APIs, so it works on mobile and follows the user's attachment and link settings.
export async function saveArticleToVault(app: App, bundle: Bundle, mode: Mode, doc: Document, images: LocalImages, includeImages: boolean, folderSetting: string): Promise<{ file: TFile; missingImages: number }> {
  const body = bundle.entry.origin === 'vault' ? null : articleExportBody(bundle, mode, doc, includeImages);
  if (!articleExportMarkdown(bundle, mode, body)) fail('error.noExportableContent');
  const folder = articleFolderPath(folderSetting);
  await ensureFolder(app, folder);
  const name = exportBaseName(bundle, mode), path = availableNotePath(p => !!app.vault.getAbstractFileByPath(p), folder, name);
  const links = new Map<string, string>(), created: TFile[] = [];
  let missingImages = 0;
  try {
    for (const [index, img] of [...(body?.querySelectorAll<HTMLImageElement>('img[src]') ?? [])].entries()) {
      const url = img.getAttribute('src'); if (!url) continue;
      try {
        const blob = await images.load(url), extension = imageTypes[blob.type];
        if (!extension) fail('error.imageFormatUnsupported');
        const target = await app.fileManager.getAvailablePathForAttachment(`${name}-${index + 1}.${extension}`, path);
        const file = await app.vault.createBinary(target, await blob.arrayBuffer()); created.push(file);
        const token = `qrs-asset-${index}`; img.setAttribute('src', token); links.set(token, app.fileManager.generateMarkdownLink(file, path));
      } catch { missingImages++; }
    }
    const markdown = articleExportMarkdown(bundle, mode, body);
    if (!markdown) fail('error.noExportableContent');
    return { file: await app.vault.create(path, linkAttachments(markdown, links)), missingImages };
  } catch (error) {
    // A failed save leaves no orphaned images behind; the user's trash setting decides where they go.
    for (const file of created) await app.fileManager.trashFile(file).catch(() => undefined);
    throw error;
  }
}
