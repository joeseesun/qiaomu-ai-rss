import serif from '../fonts/SourceHanSerifCN-Regular.otf.gz';
import sans from '../fonts/SourceHanSansCN-Regular.otf.gz';
import wenkai from '../fonts/LXGWWenKaiGBScreen-Regular.ttf.gz';
import zhenkai from '../fonts/LXGWZhenKaiGB-Regular.ttf.gz';
import fangsong from '../fonts/ZhuqueFangsong-Regular.ttf.gz';
import type { ReadingFont } from './model';

export const readingFonts: { id: ReadingFont; name: string; family: string; data?: string }[] = [
  { id: 'serif', name: '系统宋体', family: '"Songti SC",Georgia,serif' },
  { id: 'sans', name: '系统黑体', family: 'var(--font-text),"PingFang SC",sans-serif' },
  { id: 'sourceHanSerif', name: '思源宋体', family: 'QRS Source Han Serif', data: serif },
  { id: 'sourceHanSans', name: '思源黑体', family: 'QRS Source Han Sans', data: sans },
  { id: 'wenkai', name: '霞鹜文楷 · 屏幕版', family: 'QRS WenKai', data: wenkai },
  { id: 'zhenkai', name: '霞鹜臻楷', family: 'QRS ZhenKai', data: zhenkai },
  { id: 'fangsong', name: '朱雀仿宋', family: 'QRS Fangsong', data: fangsong },
];

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
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const face = new FontFace(font.family, await new Response(stream).arrayBuffer());
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
