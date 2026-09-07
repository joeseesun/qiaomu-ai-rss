import { setIcon } from 'obsidian';

/** Keep clearing consistent across reader, channel and discovery searches. */
export function addSearchClear(input: HTMLInputElement) {
  const wrapper = input.parentElement!.createDiv();
  wrapper.className = 'qrs-clearable-search';
  input.before(wrapper); wrapper.append(input);
  const button = wrapper.createEl('button', { cls: 'qrs-search-clear', attr: { type: 'button' } });
  setIcon(button, 'x');
  button.createSpan({ cls: 'qrs-visually-hidden', text: '清除搜索' });
  button.onpointerdown = event => event.preventDefault();
  button.onclick = () => {
    input.value = '';
    input.dispatchEvent(new (input.ownerDocument.defaultView!.Event)('input', { bubbles: true }));
    input.focus({ preventScroll: true });
  };
}
