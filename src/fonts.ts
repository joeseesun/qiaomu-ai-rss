import fangsong from '../fonts/QiaomuReadingFangsong.woff2';
import type { ReadingFont } from './model';

export const readingFonts: { id: ReadingFont; name: string; family: string; data?: string }[] = [
  { id: 'serif', name: '系统宋体', family: '"Songti SC",Georgia,serif' },
  { id: 'sans', name: '系统黑体', family: 'var(--font-text),"PingFang SC",sans-serif' },
  { id: 'custom', name: '设备字体…', family: 'serif' },
  { id: 'sourceHanSerif', name: '思源宋体', family: '"Source Han Serif CN",serif' },
  { id: 'sourceHanSans', name: '思源黑体', family: '"Source Han Sans CN",sans-serif' },
  { id: 'wenkai', name: '霞鹜文楷 · 屏幕版', family: '"LXGW WenKai GB Screen",serif' },
  { id: 'zhenkai', name: '霞鹜臻楷', family: '"LXGW ZhenKai GB",serif' },
  { id: 'fangsong', name: '朱雀仿宋', family: 'QRS Fangsong', data: fangsong },
];

export const selectableFonts = readingFonts.filter(font => ['fangsong', 'serif', 'sans', 'custom'].includes(font.id));
export function fontFamily(id: ReadingFont, custom: string) {
  const font = readingFonts.find(font => font.id === id)!;
  return id === 'custom' ? `${JSON.stringify(custom.trim() || 'serif')},serif` : font.data ? `"${font.family}",serif` : font.family;
}

export class ReadingFonts {
  private documents = new Map<Document, Map<string, Promise<FontFace>>>();
  private disposed = false;
  async load(doc: Document, id: ReadingFont): Promise<void> {
    const font = readingFonts.find(font => font.id === id);
    if (!font?.data || this.disposed) return;
    let loads = this.documents.get(doc);
    if (!loads) { loads = new Map(); this.documents.set(doc, loads); }
    let pending = loads.get(id);
    if (!pending) {
      const data = font.data;
      pending = (async () => {
        const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), char => char.charCodeAt(0));
        const face = new FontFace(font.family, bytes);
        await face.load();
        if (!this.disposed) doc.fonts.add(face);
        return face;
      })();
      loads.set(id, pending);
    }
    try { await pending; } catch (error) { loads.delete(id); throw error; }
  }
  dispose() {
    this.disposed = true;
    for (const [doc, loads] of this.documents) {
      for (const pending of loads.values()) void pending.then(face => doc.fonts.delete(face)).catch(() => undefined);
    }
    this.documents.clear();
  }
}
