/** A selection action, shown only after an explicit text selection. */
export class SelectionCapture {
  private popup?: HTMLElement;
  constructor(private doc: Document, private reader: () => HTMLElement, private capture: () => ((text: string) => Promise<void>) | null) {
    doc.addEventListener('pointerup', this.update);
    doc.addEventListener('keyup', this.update);
    doc.addEventListener('selectionchange', this.selectionChanged);
    doc.addEventListener('scroll', this.clear, true);
    doc.defaultView?.addEventListener('resize', this.clear);
    doc.addEventListener('keydown', this.escape);
  }
  clear = () => { this.popup?.remove(); this.popup = undefined; };
  private selectionChanged = () => { if (this.doc.getSelection()?.isCollapsed) this.clear(); };
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
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const viewport = this.doc.documentElement;
    const popup = this.doc.body.createDiv({ cls: 'qrs-selection-popup' }); this.popup = popup;
    const button = popup.createEl('button', { text: '摘录到今日日记' });
    button.onpointerdown = event => event.preventDefault();
    button.onclick = () => { this.clear(); void save(text); };
    popup.setCssProps({ '--qrs-popup-x': `${Math.max(8, Math.min(rect.left + rect.width / 2 - popup.offsetWidth / 2, viewport.clientWidth - popup.offsetWidth - 8))}px`,
      '--qrs-popup-y': `${Math.max(8, Math.min(rect.bottom + 8, viewport.clientHeight - popup.offsetHeight - 8))}px` });
  };
  dispose() {
    this.clear();
    this.doc.removeEventListener('pointerup', this.update);
    this.doc.removeEventListener('keyup', this.update);
    this.doc.removeEventListener('selectionchange', this.selectionChanged);
    this.doc.removeEventListener('scroll', this.clear, true);
    this.doc.defaultView?.removeEventListener('resize', this.clear);
    this.doc.removeEventListener('keydown', this.escape);
  }
}
