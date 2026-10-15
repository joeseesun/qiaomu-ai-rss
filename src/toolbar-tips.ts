/** Reader-owned tips; hidden button text remains the accessible name (no host/native tooltip). */
export class ToolbarTips {
  private target?: HTMLElement;
  private tip?: HTMLElement;
  private timer?: number;
  private labelObserver?: MutationObserver;
  private cleanups: (() => void)[] = [];
  private readonly win: Window;
  constructor(private root: HTMLElement) {
    this.win = root.ownerDocument.defaultView!;
    const listen = <K extends keyof HTMLElementEventMap>(type: K, fn: (event: HTMLElementEventMap[K]) => void) => {
      root.addEventListener(type, fn); this.cleanups.push(() => root.removeEventListener(type, fn));
    };
    listen('pointerover', event => {
      if (event.pointerType === 'touch') return;
      const button = this.button(event.target);
      if (button && !button.contains(event.relatedTarget as Node | null)) this.schedule(button, 450);
    });
    listen('pointerout', event => {
      const button = this.button(event.target);
      if (button === this.target && !button?.contains(event.relatedTarget as Node | null)) this.leave();
    });
    listen('focusin', event => { const button = this.button(event.target); if (button?.matches(':focus-visible')) this.schedule(button, 0); });
    listen('focusout', () => this.hide());
    listen('pointerdown', () => this.hide());
    listen('click', () => this.hide());
    const dismiss = () => this.hide();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.target) { event.stopPropagation(); this.hide(); } };
    root.ownerDocument.addEventListener('keydown', escape, true);
    this.win.addEventListener('scroll', dismiss, true);
    this.win.addEventListener('resize', dismiss);
    this.win.addEventListener('blur', dismiss);
    this.cleanups.push(() => {
      root.ownerDocument.removeEventListener('keydown', escape, true);
      this.win.removeEventListener('scroll', dismiss, true);
      this.win.removeEventListener('resize', dismiss);
      this.win.removeEventListener('blur', dismiss);
    });
  }
  private button(target: EventTarget | null): HTMLElement | undefined {
    const button = (target as HTMLElement | null)?.closest?.<HTMLElement>('.qrs-reader-toolbar [data-qrs-tip]');
    return button && this.root.contains(button) && !button.matches(':disabled') ? button : undefined;
  }
  private clearTimer() { if (this.timer !== undefined) this.win.clearTimeout(this.timer); this.timer = undefined; }
  private schedule(button: HTMLElement, delay: number) {
    if (button === this.target && this.tip) { this.clearTimer(); return; }
    this.hide(); this.target = button;
    this.timer = this.win.setTimeout(() => { this.timer = undefined; this.show(button); }, delay);
  }
  private leave() {
    if (this.root.ownerDocument.activeElement === this.target && this.target?.matches(':focus-visible')) return;
    this.clearTimer(); this.timer = this.win.setTimeout(() => this.hide(), 120);
  }
  private show(button: HTMLElement) {
    if (!button.isConnected || !this.root.contains(button) || button.matches(':disabled') || this.target !== button) { this.hide(); return; }
    const label = button.querySelector('.qrs-visually-hidden')?.textContent;
    if (!label) { this.hide(); return; }
    const tip = this.tip = button.ownerDocument.body.createDiv({ cls: 'qrs-toolbar-tip', text: label, attr: { role: 'tooltip', id: `qrs-tip-${crypto.randomUUID()}` } });
    const description = button.getAttribute('aria-describedby');
    button.setAttribute('aria-describedby', [description, tip.id].filter(Boolean).join(' '));
    tip.onpointerenter = () => this.clearTimer(); tip.onpointerleave = () => this.leave();
    const Observer = (this.win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
    this.labelObserver = new Observer(() => {
      if (!button.isConnected || button.matches(':disabled')) { this.hide(); return; }
      tip.setText(button.querySelector('.qrs-visually-hidden')?.textContent || ''); this.position();
    });
    this.labelObserver.observe(button, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    this.position();
  }
  private position() {
    if (!this.tip || !this.target) return;
    const rect = this.target.getBoundingClientRect(), bounds = this.tip.getBoundingClientRect(), gap = 8;
    const left = Math.max(gap, Math.min(rect.left + (rect.width - bounds.width) / 2, this.win.innerWidth - bounds.width - gap));
    const top = rect.bottom + gap + bounds.height <= this.win.innerHeight - gap ? rect.bottom + gap : Math.max(gap, rect.top - bounds.height - gap);
    this.tip.setCssStyles({ left: `${left}px`, top: `${top}px` });
  }
  hide() {
    this.clearTimer(); this.labelObserver?.disconnect(); this.labelObserver = undefined;
    if (this.tip && this.target) {
      const ids = (this.target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id !== this.tip?.id).join(' ');
      if (ids) this.target.setAttribute('aria-describedby', ids); else this.target.removeAttribute('aria-describedby');
    }
    this.tip?.remove(); this.tip = undefined; this.target = undefined;
  }
  dispose() { this.hide(); this.cleanups.splice(0).forEach(cleanup => cleanup()); }
}
