// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionCapture, selectionSection } from '../src/selection';

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

describe('excerpt section heading', () => {
  const fixture = () => {
    const prose = document.createElement('article');
    prose.innerHTML = '<h1>Article title</h1><p>Introduction</p><h2>First section</h2><p>First paragraph</p><h3>Nested <em>heading</em></h3><p>Nested paragraph</p><h2>Next section</h2><p>Next paragraph</p>';
    return prose;
  };
  it.each([[0, ''], [1, 'First section'], [2, 'Nested heading'], [3, 'Next section']])('uses the heading before paragraph %s without repeating the article title', (index, expected) => {
    const prose = fixture(), range = document.createRange();
    range.selectNodeContents(prose.querySelectorAll('p')[index]);
    expect(selectionSection(prose, range, 'Article title')).toBe(expected);
  });
  it('uses the start section when the range spans sections, including a backward selection', () => {
    const prose = fixture(), paragraphs = prose.querySelectorAll('p'), range = document.createRange();
    range.setStart(paragraphs[1].firstChild!, 0); range.setEnd(paragraphs[3].firstChild!, 4);
    expect(selectionSection(prose, range, 'Article title')).toBe('First section');
    document.body.append(prose);
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(paragraphs[3].firstChild!, 4, paragraphs[1].firstChild!, 0);
    expect(selectionSection(prose, selection.getRangeAt(0), 'Article title')).toBe('First section');
    selection.removeAllRanges(); prose.remove();
  });
  it('returns empty for missing headings, missing ranges and selections outside the article', () => {
    const prose = document.createElement('article'), range = document.createRange();
    prose.innerHTML = '<p>Only text</p>'; range.selectNodeContents(prose.firstChild!);
    expect(selectionSection(prose, range)).toBe('');
    expect(selectionSection(prose, undefined)).toBe('');
    expect(selectionSection(null, range)).toBe('');
    expect(selectionSection(fixture(), range)).toBe('');
  });
  it('respects element-offset selection boundaries and collapses heading whitespace', () => {
    const prose = document.createElement('article'), range = document.createRange();
    prose.innerHTML = '<h2>First\n  section</h2><p>Text</p><h2>Later</h2><p>Later text</p>';
    range.setStart(prose, 1); range.setEnd(prose, 2);
    expect(selectionSection(prose, range)).toBe('First section');
  });
});

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
