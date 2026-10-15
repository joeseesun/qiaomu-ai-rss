// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToolbarTips } from '../src/toolbar-tips';
let tips: ToolbarTips;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperties(HTMLElement.prototype, {
    createDiv: { configurable: true, value(options: {cls: string; text: string; attr: Record<string,string>}) { const el = document.createElement('div'); el.className = options.cls; el.textContent = options.text; for (const [k,v] of Object.entries(options.attr)) el.setAttribute(k,v); this.append(el); return el; } },
    setText: { configurable: true, value(text: string) { this.textContent = text; } },
    setCssStyles: { configurable: true, value(styles: Record<string,string>) { Object.assign(this.style, styles); } },
  });
});
afterEach(() => { tips?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
function fixture() {
  const root = document.createElement('section'); root.innerHTML = '<div class="qrs-reader-toolbar"><button data-qrs-tip="read"><span class="qrs-visually-hidden">标为未读</span></button></div>';
  document.body.append(root); tips = new ToolbarTips(root); return {root, button: root.querySelector('button')!};
}
function point(button: HTMLElement, type = 'pointerover', pointerType = 'mouse') {
  const event = new MouseEvent(type, {bubbles:true}); Object.defineProperty(event,'pointerType',{value:pointerType}); button.dispatchEvent(event);
}
it('delays hover, uses one custom tip, and Escape clears only its description', () => {
  const {button} = fixture(); button.setAttribute('aria-describedby','existing'); point(button);
  vi.advanceTimersByTime(449); expect(document.querySelector('[role=tooltip]')).toBeNull();
  vi.advanceTimersByTime(1); const tip = document.querySelector('[role=tooltip]')!;
  expect(tip.textContent).toBe('标为未读'); expect(button.getAttribute('aria-describedby')).toBe('existing '+tip.id);
  expect(button.hasAttribute('title')).toBe(false); expect(button.hasAttribute('aria-label')).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); expect(document.querySelector('[role=tooltip]')).toBeNull(); expect(button.getAttribute('aria-describedby')).toBe('existing');
});
it('keyboard focus shows a tip without moving focus, blur dismisses it', () => {
  const {button} = fixture();
  // jsdom has no keyboard modality model; real Tab navigation is checked in Obsidian.
  const matches = button.matches.bind(button); vi.spyOn(button, 'matches').mockImplementation(selector => selector === ':focus-visible' || matches(selector));
  button.focus(); vi.advanceTimersByTime(0);
  expect(document.querySelector('[role=tooltip]')).not.toBeNull(); expect(document.activeElement).toBe(button);
  button.blur(); expect(document.querySelector('[role=tooltip]')).toBeNull();
});
it('can hover the popup and updates its action after a state change', async () => {
  const {button} = fixture(); point(button); vi.advanceTimersByTime(450);
  const tip = document.querySelector<HTMLElement>('[role=tooltip]')!; point(button,'pointerout'); tip.dispatchEvent(new MouseEvent('pointerenter'));
  vi.advanceTimersByTime(200); expect(tip.isConnected).toBe(true);
  button.querySelector('span')!.textContent = '标为已读'; await Promise.resolve(); expect(tip.textContent).toBe('标为已读');
  tip.dispatchEvent(new MouseEvent('pointerleave')); vi.advanceTimersByTime(120); expect(tip.isConnected).toBe(false);
});
it('ignores touch and cancels pending tips on click, removal, and disposal', () => {
  const {button} = fixture(); point(button,'pointerover','touch'); vi.advanceTimersByTime(500); expect(document.querySelector('[role=tooltip]')).toBeNull();
  point(button); button.click(); vi.advanceTimersByTime(500); expect(document.querySelector('[role=tooltip]')).toBeNull();
  point(button); button.remove(); vi.advanceTimersByTime(500); expect(document.querySelector('[role=tooltip]')).toBeNull();
  tips.dispose(); expect(vi.getTimerCount()).toBe(0);
});
it('scroll and view disposal dismiss visible tips and release their references', () => {
  const {button} = fixture(); point(button); vi.advanceTimersByTime(450); window.dispatchEvent(new Event('scroll'));
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  point(button); vi.advanceTimersByTime(450); tips.dispose(); expect(document.querySelector('[role=tooltip]')).toBeNull(); expect(button.hasAttribute('aria-describedby')).toBe(false);
  point(button); vi.advanceTimersByTime(500); expect(document.querySelector('[role=tooltip]')).toBeNull();
});
