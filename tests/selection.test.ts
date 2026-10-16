// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionCapture } from '../src/selection';

// The fixture implements only Obsidian's DOM conveniences, never touches a vault.
function createEl(this: HTMLElement, tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.appendChild(el); return el;
}
Object.assign(HTMLElement.prototype, {
  createEl,
  createDiv(this: HTMLElement, options: { cls?: string }) { return createEl.call(this, 'div', options); },
  createSpan(this: HTMLElement, options: { cls?: string; text?: string }) { return createEl.call(this, 'span', options); },
  setCssProps(this: HTMLElement, values: Record<string, string>) { for (const [key, value] of Object.entries(values)) this.style.setProperty(key, value); },
});
Object.assign(Range.prototype, { getBoundingClientRect: () => ({ left: 100, bottom: 100, width: 100 }) });

describe('selection capture dismissal', () => {
  let capture: SelectionCapture, prose: HTMLElement, outside: HTMLElement, save: ReturnType<typeof vi.fn>;
  const popup = () => document.querySelector('.qrs-selection-popup');
  const select = (end = 7) => {
    const range = document.createRange(); range.setStart(prose.firstChild!, 0); range.setEnd(prose.firstChild!, end);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(200);
  };
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = '<section class="qrs-root"><article class="qrs-prose">fixture article text</article></section><button id="outside">menu</button>';
    prose = document.querySelector('.qrs-prose')!; outside = document.querySelector('#outside')!;
    save = vi.fn().mockResolvedValue(undefined);
    capture = new SelectionCapture(document, () => document.querySelector('section')!, () => [{ label: 'Capture', icon: 'calendar-plus', save }]);
  });
  afterEach(() => { capture.dispose(); document.getSelection()!.removeAllRanges(); vi.useRealTimers(); });
  it.each(['pointerdown', 'touchstart'])('lets an outside %s dismiss and activate the original target', type => {
    select(); expect(popup()).not.toBeNull(); const clicked = vi.fn(); outside.onclick = clicked;
    const down = new Event(type, { bubbles: true, cancelable: true }); outside.dispatchEvent(down);
    outside.dispatchEvent(new Event('pointerup', { bubbles: true })); outside.click(); vi.advanceTimersByTime(300);
    expect(down.defaultPrevented).toBe(false); expect(clicked).toHaveBeenCalledOnce(); expect(popup()).toBeNull(); expect(save).not.toHaveBeenCalled();
  });
  it('does not reopen the dismissed range on pointerup or delayed selectionchange; a changed range works', () => {
    select(); prose.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.getSelection()!.toString()).toBe('fixture');
    prose.dispatchEvent(new Event('pointerup', { bubbles: true })); document.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(300);
    expect(popup()).toBeNull(); select(15); expect(popup()).not.toBeNull();
  });
  it.each(['pointercancel', 'touchcancel'])('does not revive a popup after %s', type => {
    select(); document.dispatchEvent(new Event(type)); document.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(300);
    expect(popup()).toBeNull(); expect(save).not.toHaveBeenCalled();
  });
  it('cancels a pending popup before it can cover an outside tap', () => {
    select(); capture.clear(); document.dispatchEvent(new Event('selectionchange')); outside.dispatchEvent(new Event('touchstart', { bubbles: true })); vi.advanceTimersByTime(300); expect(popup()).toBeNull();
  });
  it('keeps icon buttons accessible and preserves capture on a popup press', () => {
    select(); const button = popup()!.querySelector('button')!;
    expect(button.classList.contains('clickable-icon')).toBe(true); expect(button.getAttribute('aria-label')).toBe('Capture');
    button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true })); button.dispatchEvent(new Event('pointerup', { bubbles: true })); button.click();
    expect(save).toHaveBeenCalledExactlyOnceWith('fixture', expect.any(Range)); expect(popup()).toBeNull();
  });
  it('removes dismissal listeners and pending updates on dispose', () => {
    select(); capture.dispose(); select(15); expect(popup()).toBeNull();
  });
});
