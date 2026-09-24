import fangsong from '../fonts/QiaomuReadingFangsong.woff2';
import type { ReadingFont } from './model';
import { t, type MessageKey } from './i18n';

export const readingFonts: { id: ReadingFont; family: string; data?: string }[] = [
  { id: 'serif', family: '"Songti SC",Georgia,serif' },
  { id: 'sans', family: 'var(--font-text),"PingFang SC",sans-serif' },
  { id: 'custom', family: 'serif' },
  { id: 'sourceHanSerif', family: '"Source Han Serif CN",serif' },
  { id: 'sourceHanSans', family: '"Source Han Sans CN",sans-serif' },
  { id: 'wenkai', family: '"LXGW WenKai GB Screen",serif' },
  { id: 'zhenkai', family: '"LXGW ZhenKai GB",serif' },
  { id: 'fangsong', family: 'QRS Fangsong', data: fangsong },
];

const fontKeys: Record<ReadingFont, MessageKey> = {
  serif: 'font.serif', sans: 'font.sans', custom: 'font.custom', sourceHanSerif: 'font.sourceHanSerif',
  sourceHanSans: 'font.sourceHanSans', wenkai: 'font.wenkai', zhenkai: 'font.zhenkai', fangsong: 'font.fangsong',
};
/** Display name of a reading font in the current interface language. */
export function fontName(id: ReadingFont): string {
  return t(fontKeys[id]);
}

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
