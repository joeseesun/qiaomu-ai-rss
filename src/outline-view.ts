import { ItemView, Platform, setIcon, type WorkspaceLeaf } from 'obsidian';
import type QiaomuRssPlugin from './main';
import type { ReaderView } from './view';
import { ArticleOutline, articleHeadings, type OutlineContext } from './article-outline';
import { t } from './i18n';

export const OUTLINE_VIEW_TYPE = 'qiaomu-ai-rss-outline';

export class OutlineView extends ItemView {
  reader: ReaderView | null = null;
  private outline?: ArticleOutline;
  private context?: OutlineContext | null;
  private rows: HTMLButtonElement[] = [];
  private title!: HTMLElement;
  private body!: HTMLElement;
  constructor(leaf: WorkspaceLeaf, private plugin: QiaomuRssPlugin) { super(leaf); }
  getViewType() { return OUTLINE_VIEW_TYPE; }
  getDisplayText() { return t('outline.title'); }
  getIcon() { return 'list-tree'; }
  onOpen(): Promise<void> {
    this.contentEl.addClass('qrs-outline');
    this.contentEl.empty();
    const head = this.contentEl.createDiv('qrs-outline-head');
    head.createEl('strong', { text: t('outline.title') });
    const close = head.createEl('button', { cls: 'qrs-outline-close' });
    setIcon(close, 'x'); close.createSpan({ cls: 'qrs-visually-hidden', text: t('outline.close') });
    close.onclick = () => this.leaf.detach();
    this.title = this.contentEl.createDiv('qrs-outline-article');
    this.body = this.contentEl.createDiv('qrs-outline-body');
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      if (leaf?.view.containerEl.ownerDocument !== this.contentEl.ownerDocument) return;
      if (leaf.view.getViewType() === 'qiaomu-ai-rss-reader') this.setReader(leaf.view as ReaderView);
      else if (leaf.view.getViewType() === 'markdown') this.setReader(null);
    }));
    const recent = this.app.workspace.getMostRecentLeaf();
    const reader = recent?.view.getViewType() === 'qiaomu-ai-rss-reader' ? recent :
      this.app.workspace.getLeavesOfType('qiaomu-ai-rss-reader').find(leaf => leaf.view.containerEl.ownerDocument === this.contentEl.ownerDocument);
    this.setReader((reader?.view as ReaderView | undefined) ?? null);
    return Promise.resolve();
  }
  setReader(reader: ReaderView | null) {
    this.reader = reader;
    this.refresh();
  }
  refresh() {
    if (!this.body) return;
    const context = this.reader?.outlineContext() ?? null;
    if (context && this.context?.prose === context.prose && this.context.scroller === context.scroller && this.context.title === context.title && this.context.loading === context.loading) {
      const items = context.prose ? articleHeadings(context.prose) : [];
      const previous = this.outline?.items ?? [];
      if (items.length === previous.length && items.every((item, index) => item.element === previous[index].element && item.text === previous[index].text && item.depth === previous[index].depth)) return;
    }
    this.outline?.dispose(); this.outline = undefined;
    this.context = context; this.rows = []; this.body.empty();
    this.title.setText(context?.title ?? '');
    this.title.toggleClass('is-hidden', !context);
    if (context?.prose) {
      this.outline = new ArticleOutline(context, index => this.select(index));
      const list = this.body.createEl('ul', { cls: 'qrs-outline-list' });
      for (const [index, heading] of this.outline.items.entries()) {
        const row = list.createEl('li').createEl('button', { cls: 'qrs-outline-row', text: heading.text });
        row.setCssProps({ '--qrs-outline-depth': String(heading.depth) });
        row.onclick = () => {
          this.outline?.jump(index);
          if (Platform.isMobileApp) this.app.workspace.rightSplit.collapse();
        };
        this.rows.push(row);
      }
      if (this.rows.length) return;
      list.remove();
    }
    this.body.createDiv({ cls: 'qrs-outline-empty', text: t(!context ? 'outline.noArticle' : context.loading ? 'reader.loadingContent' : 'outline.noHeadings') });
  }
  private select(index: number) {
    for (const [i, row] of this.rows.entries()) {
      row.toggleClass('is-active', i === index);
      if (i === index) row.setAttribute('aria-current', 'location'); else row.removeAttribute('aria-current');
    }
    const row = this.rows[index];
    if (!row || this.body.contains(this.contentEl.ownerDocument.activeElement)) return;
    const bounds = this.body.getBoundingClientRect(), rect = row.getBoundingClientRect();
    if (rect.top < bounds.top) this.body.scrollTop -= bounds.top - rect.top;
    else if (rect.bottom > bounds.bottom) this.body.scrollTop += rect.bottom - bounds.bottom;
  }
  onClose(): Promise<void> {
    this.outline?.dispose(); this.outline = undefined; this.reader = null;
    this.plugin.refreshOutlineButtons();
    return Promise.resolve();
  }
}
