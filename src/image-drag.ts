import { Notice, TFile, type App } from 'obsidian';
import { imageMime, type LocalImages } from './images';
import { safeUrl } from './model';

export function enableImageDrag(img: HTMLImageElement, blob: Blob) {
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[blob.type];
  if (!extension) return;
  const file = new File([blob], `rss-image-${Date.now()}.${extension}`, { type: blob.type });
  img.draggable = true;
  img.ondragstart = event => {
    if (!event.dataTransfer) return;
    event.stopPropagation();
    event.dataTransfer.clearData();
    event.dataTransfer.items.add(file);
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
