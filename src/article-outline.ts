/** The outline refers to rendered headings, so duplicate titles need no synthetic IDs. */
export interface ArticleHeading { element: HTMLElement; text: string; depth: number }
export interface OutlineContext {
  title: string;
  loading: boolean;
  prose: HTMLElement | null;
  scroller: HTMLElement;
  beforeJump: () => void;
}

export function articleHeadings(prose: HTMLElement): ArticleHeading[] {
  const levels: number[] = [];
  const items: ArticleHeading[] = [];
  for (const element of prose.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || element.closest('[hidden]')) continue;
    const level = Number(element.tagName.slice(1));
    while (levels.length && levels[levels.length - 1] >= level) levels.pop();
    items.push({ element, text, depth: levels.length });
    levels.push(level);
  }
  return items;
}

/** Measures on layout changes only; ordinary scrolling uses a cached binary search. */
export class ArticleOutline {
  readonly items: ArticleHeading[];
  private tops: number[] = [];
  private inset = 16;
  private active = -1;
  private frame?: number;
  private dirty = true;
  private observer?: ResizeObserver;
  private readonly win: Window;
  constructor(private context: OutlineContext, private onActive: (index: number) => void) {
    this.win = context.scroller.ownerDocument.defaultView!;
    this.items = context.prose ? articleHeadings(context.prose) : [];
    context.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    context.prose?.addEventListener('load', this.onResize, true);
    this.win.addEventListener('resize', this.onResize);
    const Observer = context.scroller.ownerDocument.defaultView!.ResizeObserver;
    if (Observer) {
      this.observer = new Observer(this.onResize);
      this.observer.observe(context.scroller);
      const article = context.prose?.closest('.qrs-article');
      if (article) this.observer.observe(article);
      const head = context.scroller.querySelector('.qrs-reader-head');
      if (head) this.observer.observe(head);
    }
    this.schedule();
  }
  private onScroll = () => this.schedule();
  private onResize = () => { this.dirty = true; this.schedule(); };
  private schedule() {
    if (this.frame !== undefined) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = undefined;
      this.update();
    });
  }
  private measure() {
    const { scroller } = this.context;
    this.inset = (scroller.querySelector('.qrs-reader-head')?.getBoundingClientRect().height || 0) + 16;
    const origin = scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
    this.tops = this.items.map(item => item.element.getBoundingClientRect().top - origin);
    this.dirty = false;
  }
  private update() {
    if (this.dirty) this.measure();
    const { scroller } = this.context;
    const position = scroller.scrollTop + this.inset + 1;
    let low = 0, high = this.tops.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.tops[mid] <= position) low = mid + 1; else high = mid;
    }
    let next = this.items.length ? Math.max(0, low - 1) : -1;
    if (scroller.scrollHeight > scroller.clientHeight + 1 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) next = this.items.length - 1;
    if (next !== this.active) { this.active = next; this.onActive(next); }
  }
  jump(index: number) {
    const item = this.items[index];
    if (!item || !item.element.isConnected) return;
    this.context.beforeJump();
    this.measure();
    const scroller = this.context.scroller;
    const top = Math.max(0, Math.min(this.tops[index] - this.inset, scroller.scrollHeight - scroller.clientHeight));
    // Only scroll the article. scrollIntoView could move the workspace or the sidebar too.
    scroller.scrollTo({ top, behavior: 'instant' });
    this.update();
  }
  dispose() {
    if (this.frame !== undefined) this.win.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.context.scroller.removeEventListener('scroll', this.onScroll);
    this.context.prose?.removeEventListener('load', this.onResize, true);
    this.win.removeEventListener('resize', this.onResize);
  }
}

export function jumpToArticleSection(context: OutlineContext | null, section: string): void {
  if (!section || !context?.prose) return;
  const outline = new ArticleOutline(context, () => undefined);
  try { outline.jump(outline.items.findIndex(item => item.text === section.replace(/\s+/g, ' ').trim())); }
  finally { outline.dispose(); }
}
