import { Platform } from 'obsidian';
import { exportBaseName } from './article-export';
import { fontFamily, readingFonts } from './fonts';
import { safeUrl, titleOf, type Bundle, type Mode } from './model';
import type { State } from './model';
import type { LocalImages } from './images';
import { fail, t } from './i18n';

function desktop() {
  if (!Platform.isDesktopApp) fail('error.desktopOnly');
  // Obsidian's desktop renderer provides CommonJS require; native dynamic import cannot resolve electron here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- Obsidian exposes Electron through require in its desktop renderer.
  const { remote } = require('electron') as typeof import('electron');
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- This branch runs only in the desktop app.
  const fs = (require('node:fs') as typeof import('node:fs')).promises;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- This branch runs only in the desktop app.
  const path = require('node:path') as typeof import('node:path');
  return {
    remote, fs, path,
  };
}

// PDFs usually leave the vault, so the system dialog stays; it opens where the last PDF went.
async function choosePdfFile(bundle: Bundle, mode: Mode, directory: string): Promise<string | null> {
  const { remote, path } = desktop();
  const name = `${exportBaseName(bundle, mode)}.pdf`;
  const result = await remote.dialog.showSaveDialog(remote.getCurrentWindow(), {
    title: t('reader.exportPdf'),
    defaultPath: directory ? path.join(directory, name) : name,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return result.canceled ? null : result.filePath || null;
}

async function assertNewFile(file: string): Promise<void> {
  const { fs } = desktop();
  try { await fs.access(file); fail('error.fileExists'); }
  catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
}

async function embedImages(article: HTMLElement, original: HTMLElement, images: LocalImages): Promise<number> {
  const live = [...original.querySelectorAll<HTMLImageElement>('img')];
  let missing = 0;
  for (const [index, img] of [...article.querySelectorAll<HTMLImageElement>('img')].entries()) {
    const source = live[index];
    try {
      let drawable: CanvasImageSource;
      if (source?.complete && source.naturalWidth) drawable = source;
      else {
        const url = img.dataset.qrsImage || img.getAttribute('src');
        if (!url) fail('error.imageUrlUnavailable');
        drawable = await createImageBitmap(await images.load(url));
      }
      const width = drawable instanceof HTMLImageElement ? drawable.naturalWidth : drawable.width;
      const height = drawable instanceof HTMLImageElement ? drawable.naturalHeight : drawable.height;
      const canvas = article.ownerDocument.createElement('canvas');
      canvas.width = Math.min(1200, width); canvas.height = Math.round(height * canvas.width / width);
      const context = canvas.getContext('2d');
      if (!context) fail('error.imageDrawUnavailable');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
      img.src = canvas.toDataURL('image/jpeg', 0.85);
      img.removeAttribute('loading'); img.removeAttribute('data-qrs-image');
      if (drawable instanceof ImageBitmap) drawable.close();
    } catch { img.remove(); missing++; }
  }
  return missing;
}

const pdfStyles = `@page{size:A4;margin:16mm 17mm 18mm}
html,body{margin:0;padding:0;background:#fff;color:#222}
body{font-family:var(--qrs-font-family);font-size:var(--qrs-font-size);line-height:var(--qrs-line-height)}
.qrs-article{width:100%;max-width:var(--qrs-article-width);margin:auto;padding:0}
h1{font-size:1.6em;line-height:1.5;letter-spacing:-.025em;margin:0 0 26px;font-weight:600;overflow-wrap:anywhere}
.qrs-article-original-title{color:#666;font-size:14px;line-height:1.5;margin-bottom:24px}
h2{font-size:1.3em;line-height:1.6;margin:1.8em 0 .7em;break-after:avoid-page}
h3{font-size:1.12em;margin:1.6em 0 .6em;break-after:avoid-page}
.qrs-podcast-meta,.qrs-wechat-source{font-size:11px;color:#666;margin:0 0 24px}
.qrs-prose p{margin:1.1em 0;orphans:2;widows:2}
.qrs-prose em,.qrs-prose i{font-style:normal;font-weight:600}
.qrs-prose img{display:block;max-width:100%;max-height:85mm;width:auto;height:auto;margin:12px auto;break-inside:avoid}
.qrs-prose pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:16px;border-radius:6px;break-inside:avoid}
.qrs-prose blockquote{background:#f5f5f5;margin:1.4em 0;padding:16px 20px;border-radius:6px;break-inside:avoid}
.qrs-prose table{border-collapse:collapse;width:100%}
.qrs-prose td,.qrs-prose th{border:1px solid #ccc;padding:5px}
a{color:#245d9b;text-decoration:underline;overflow-wrap:anywhere}
.qrs-export-source{font-size:10px;color:#777;margin-top:2em;border-top:1px solid #ddd;padding-top:8px}`;

export async function saveArticlePdf(bundle: Bundle, mode: Mode, currentArticle: HTMLElement, images: LocalImages, settings: State['settings']): Promise<{ path: string; missingImages: number } | null> {
  const article = currentArticle.cloneNode(true) as HTMLElement;
  const prose = article.querySelector('.qrs-prose');
  if (!prose || (!prose.textContent?.trim() && !prose.querySelector('img'))) fail('error.noExportableContent');
  article.querySelectorAll('.qrs-media,.qrs-feedback,.qrs-empty,audio,video,iframe,button,script,style,object,embed').forEach(element => element.remove());
  const file = await choosePdfFile(bundle, mode, settings.pdfDirectory);
  if (!file) return null;
  await assertNewFile(file);
  const missingImages = await embedImages(article, currentArticle, images);
  const source = bundle.entry.link ? safeUrl(bundle.entry.link) : null;
  if (source) {
    const footer = article.ownerDocument.createElement('p'); footer.className = 'qrs-export-source';
    const anchor = article.ownerDocument.createElement('a'); anchor.href = source; anchor.textContent = t('export.originalLinkPrefix', { source });
    footer.append(anchor); article.append(footer);
  }
  const title = article.ownerDocument.createElement('title'); title.textContent = titleOf(bundle.entry);
  const selectedFont = readingFonts.find(font => font.id === settings.fontFamily);
  const embeddedFont = selectedFont?.data ? `@font-face{font-family:"${selectedFont.family}";src:url("font.woff2") format("woff2");font-weight:normal;font-style:normal}` : '';
  const appearance = `:root{--qrs-font-family:${fontFamily(settings.fontFamily, settings.customFont)};--qrs-font-size:${settings.fontSize}px;--qrs-line-height:${settings.lineHeight};--qrs-article-width:${settings.fontSize * settings.lineWidth + 120}px}`;
  const html = `<!doctype html><html><head><meta charset="utf-8">${title.outerHTML}<style>${embeddedFont}${appearance}${pdfStyles}</style></head><body>${article.outerHTML}</body></html>`;
  const { remote, fs, path } = desktop();
  const temporary = await fs.mkdtemp(path.join(remote.app.getPath('temp'), 'qrs-export-'));
  const win = new remote.BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } });
  try {
    if (selectedFont?.data) {
      const base64 = selectedFont.data.slice(selectedFont.data.indexOf(',') + 1);
      await fs.writeFile(path.join(temporary, 'font.woff2'), Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
    }
    const page = path.join(temporary, 'article.html');
    await fs.writeFile(page, html, 'utf8');
    await win.loadFile(page);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {}))))');
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') fail('error.pdfFailed');
    await fs.writeFile(file, pdf, { flag: 'wx' });
    settings.pdfDirectory = path.dirname(file);
    return { path: file, missingImages };
  } finally { win.destroy(); await fs.rm(temporary, { recursive: true, force: true }); }
}
