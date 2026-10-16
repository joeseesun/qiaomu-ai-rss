import { setIcon } from 'obsidian';
import { markdownText } from './daily-note';
export interface CaptureAction { label: string; icon: string; disabled?: boolean; save: (text: string, range: Range) => Promise<void> }
/** A selection action, shown only after an explicit text selection. */
export class SelectionCapture {
  private popup?: HTMLElement;
  private selectionTimer?: number;
  private dismissedRange?: Range;
  constructor(private doc: Document, private reader: () => HTMLElement, private capture: () => CaptureAction[] | null) {
    doc.addEventListener('pointerup', this.update);
    doc.addEventListener('pointerdown', this.pointerDown, true);
    doc.addEventListener('touchstart', this.pointerDown, { capture: true, passive: true });
    doc.addEventListener('pointercancel', this.dismiss);
    doc.addEventListener('touchcancel', this.dismiss);
    doc.addEventListener('dragstart', this.dragStart);
    doc.addEventListener('dragend', this.clear);
    doc.addEventListener('keyup', this.update);
    doc.addEventListener('selectionchange', this.selectionChanged);
    doc.addEventListener('scroll', this.clear, true);
    doc.defaultView?.addEventListener('resize', this.clear);
    doc.addEventListener('keydown', this.escape);
  }
  clear = () => { this.doc.defaultView?.clearTimeout(this.selectionTimer); this.selectionTimer = undefined; this.popup?.remove(); this.popup = undefined; };
  private dismiss = () => {
    const selection = this.doc.getSelection();
    this.dismissedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    this.clear();
  };
  private pointerDown = (event: Event) => {
    if ((!this.popup && this.selectionTimer === undefined) || this.popup?.contains(event.target as Node)) return;
    this.dismiss();
    // Leave taps and selection-handle gestures to the host. Only clear the
    // native selection when the user moves outside the article altogether.
    if (!this.reader().querySelector('.qrs-prose')?.contains(event.target as Node) && !this.reader().querySelector('.qrs-reader-head')?.contains(event.target as Node)) this.doc.getSelection()?.removeAllRanges();
  };
  private dragStart = (event: DragEvent) => {
    const selection = this.doc.getSelection(), prose = this.reader().querySelector('.qrs-prose');
    if (!event.dataTransfer || !selection || selection.isCollapsed || !prose?.contains(selection.anchorNode) || !prose.contains(selection.focusNode) || !prose.contains(event.target as Node)) return;
    this.writeDrag(event, selection.toString());
  };
  private writeDrag(event: DragEvent, text: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/plain', markdownText(text));
    event.dataTransfer.effectAllowed = 'copy';
    this.clear();
  }
  private selectionChanged = () => {
    if (this.doc.getSelection()?.isCollapsed) { this.dismissedRange = undefined; this.clear(); return; }
    this.doc.defaultView?.clearTimeout(this.selectionTimer);
    this.selectionTimer = this.doc.defaultView?.setTimeout(() => this.update(new Event('selectionchange')), 180);
  };
  private escape = (event: KeyboardEvent) => { if (event.key === 'Escape') this.clear(); };
  private update = (event: Event) => {
    if (this.popup?.contains(event.target as Node)) return;
    if (event.type === 'keyup' && (event as KeyboardEvent).key === 'Escape') return;
    this.clear();
    const selection = this.doc.getSelection();
    const prose = this.reader().querySelector('.qrs-prose');
    if (!selection?.rangeCount || selection.isCollapsed || !prose?.contains(selection.anchorNode) || !prose.contains(selection.focusNode)) return;
    const text = selection.toString().trim(); const save = this.capture();
    if (!text || !save) return;
    const range = selection.getRangeAt(0), dismissed = this.dismissedRange;
    if (dismissed && range.startContainer === dismissed.startContainer && range.startOffset === dismissed.startOffset && range.endContainer === dismissed.endContainer && range.endOffset === dismissed.endOffset) return;
    this.dismissedRange = undefined;
    const rect = range.getBoundingClientRect();
    const viewport = this.doc.documentElement;
    const popup = this.doc.body.createDiv({ cls: 'qrs-selection-popup' }); this.popup = popup;
    popup.dataset.qrsTheme = this.reader().closest<HTMLElement>('.qrs-root')?.dataset.qrsTheme ?? 'auto';
    for (const action of save) {
      const button = popup.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': action.label } });
      setIcon(button, action.icon);
      button.createSpan({ cls: 'qrs-visually-hidden', text: action.label });
      button.disabled = !!action.disabled;
      button.onpointerdown = event => event.preventDefault();
      button.onclick = () => { this.clear(); void action.save(text, range.cloneRange()); };
    }
    popup.setCssProps({ '--qrs-popup-x': `${Math.max(8, Math.min(rect.left + rect.width / 2 - popup.offsetWidth / 2, viewport.clientWidth - popup.offsetWidth - 8))}px`,
      '--qrs-popup-y': `${Math.max(8, Math.min(rect.bottom + 8, viewport.clientHeight - popup.offsetHeight - 8))}px` });
  };
  dispose() {
    this.clear();
    this.doc.removeEventListener('pointerup', this.update);
    this.doc.removeEventListener('pointerdown', this.pointerDown, true);
    this.doc.removeEventListener('touchstart', this.pointerDown, true);
    this.doc.removeEventListener('pointercancel', this.dismiss);
    this.doc.removeEventListener('touchcancel', this.dismiss);
    this.doc.removeEventListener('dragstart', this.dragStart);
    this.doc.removeEventListener('dragend', this.clear);
    this.doc.removeEventListener('keyup', this.update);
    this.doc.removeEventListener('selectionchange', this.selectionChanged);
    this.doc.removeEventListener('scroll', this.clear, true);
    this.doc.defaultView?.removeEventListener('resize', this.clear);
    this.doc.removeEventListener('keydown', this.escape);
  }
}
