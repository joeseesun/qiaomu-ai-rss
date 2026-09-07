import { EditorView } from '@codemirror/view';
import { Compartment, StateEffect } from '@codemirror/state';
import { Notice, TFile, type Plugin, type App } from 'obsidian';
import { imageMime, type LocalImages } from './images';
import { safeUrl } from './model';

const dragType = 'application/x-qiaomu-rss-image';
let activeDrag: { id: string; file: File } | undefined;

export function registerImageDrops(plugin: Plugin) {
  plugin.register(() => { activeDrag = undefined; });
  plugin.registerEvent(plugin.app.workspace.on('editor-drop', (event, editor, info) => {
    if (event.defaultPrevented || !info.file || !activeDrag || event.dataTransfer?.getData(dragType) !== activeDrag.id) return;
    const file = activeDrag.file, note = info.file;
    event.preventDefault();
    const cm = event.target instanceof HTMLElement ? EditorView.findFromDOM(event.target) : null;
    let offset = cm?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? editor.posToOffset(editor.getCursor());
    const tracking = new Compartment();
    if (cm) cm.dispatch({ effects: StateEffect.appendConfig.of(tracking.of(EditorView.updateListener.of(update => {
      offset = update.changes.mapPos(offset, 1);
    }))) });
    void (async () => {
      try {
        const path = await plugin.app.fileManager.getAvailablePathForAttachment(file.name, note.path);
        const attachment = await plugin.app.vault.createBinary(path, await file.arrayBuffer());
        const markdown = '!' + plugin.app.fileManager.generateMarkdownLink(attachment, note.path);
        if (info.file === note) editor.replaceRange(markdown, editor.offsetToPos(offset));
        else await plugin.app.vault.process(note, content => content + '\n\n' + markdown + '\n');
      } catch { new Notice('图片保存失败，请重新拖拽。'); }
      finally { if (cm) cm.dispatch({ effects: tracking.reconfigure([]) }); }
    })();
  }));
}

export function enableImageDrag(img: HTMLImageElement, blob: Blob) {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[blob.type];
  if (!extension) return;
  const file = new File([blob], `rss-image-${Date.now()}.${extension}`, { type: blob.type });
  img.draggable = true;
  img.ondragend = () => { activeDrag = undefined; };
  img.ondragstart = event => {
    if (!event.dataTransfer) return;
    event.stopPropagation();
    event.dataTransfer.clearData();
    event.dataTransfer.items.add(file);
    activeDrag = { id: crypto.randomUUID(), file };
    event.dataTransfer.setData(dragType, activeDrag.id);
    event.dataTransfer.effectAllowed = 'copy';
  };
}

/** Native Markdown embeds may refer to vault attachments rather than web URLs. */
export async function prepareMarkdownImageDrags(app: App, images: LocalImages, prose: HTMLElement, sourcePath: string) {
  await Promise.all([...prose.querySelectorAll('img')].map(async img => {
    img.draggable = false;
    try {
      const embed = img.closest('.internal-embed')?.getAttribute('src');
      const file = embed ? app.metadataCache.getFirstLinkpathDest(embed.split('#')[0], sourcePath) : null;
      let blob: Blob;
      if (file instanceof TFile) {
        if (file.stat.size > 8 * 1024 * 1024) return;
        const bytes = await app.vault.readBinary(file), mime = imageMime(bytes);
        if (!mime) return;
        blob = new Blob([bytes], { type: mime });
      } else {
        const url = safeUrl(img.getAttribute('src') || '');
        if (!url) return;
        blob = await images.load(url);
      }
      if (prose.isConnected) enableImageDrag(img, blob);
    } catch {
      img.ondragstart = event => { event.preventDefault(); new Notice('图片尚未加载完成，请重新打开文章后再拖拽。'); };
    }
  }));
}
