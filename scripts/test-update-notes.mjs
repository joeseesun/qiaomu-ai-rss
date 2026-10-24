import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
const dir = process.cwd().endsWith('/radio') ? 'plugin-src' : 'src';
const result = await build({ entryPoints: [`${dir}/update-notes.ts`], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['obsidian'] });
const notices = [], dialogs = [], timers = new Map();
let serial = 0, blocked = false;
function element(tag = 'div') {
  return { tag, children: [], events: {}, dir: '', checked: false, disabled: false,
    createEl(tag, options = {}) { const child = element(tag); child.text = options.text; this.children.push(child); return child; },
    createSpan(options) { return this.createEl('span', options); }, createDiv(options) { return this.createEl('div', options); },
    addClass() {}, prepend() {}, empty() { this.children = []; }, addEventListener(name, run) { this.events[name] = run; } };
}
class Modal {
  constructor(app) { this.app = app; this.contentEl = element(); this.modalEl = element(); }
  setTitle(title) { this.title = title; }
  open() { dialogs.push(this); this.onOpen(); }
  close() { const index = dialogs.indexOf(this); if (index < 0) return; dialogs.splice(index, 1); this.onClose(); }
}
const context = { module: { exports: {} }, require: name => { assert.equal(name, 'obsidian'); return { Modal, Plugin: class {}, Notice: class { constructor(text) { notices.push(text); } }, getLanguage: () => 'en', normalizePath: p => p, setIcon() {} }; },
  window: { setInterval: run => { const id = ++serial; timers.set(id, run); return id; }, clearInterval: id => timers.delete(id) },
  document: { querySelector: () => blocked || dialogs.length ? {} : null }, console };
vm.runInNewContext(result.outputFiles[0].text, context);
const { compareVersions, readPreferences, unseenEntries, UpdateNotes } = context.module.exports;
assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
assert.equal(compareVersions('1.2.0', '1.2'), 0);
assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
assert.equal(readPreferences({ autoShow: false, seenVersion: '1.2.3' }).autoShow, false);
assert.equal(readPreferences({ seenVersion: '<bad>' }).seenVersion, '');
const entries = [{ version: '1.0.2', items: ['introduced'] }, { version: '1.0.1', items: ['revisit'] }, { version: '2.0.0', items: ['control'] }];
assert.equal(unseenEntries(entries, '1.0.0', '1.0.2').length, 2);
assert.equal(unseenEntries(entries, '1.0.2', '1.0.2').length, 0);
assert.equal(unseenEntries(entries, '2.0.0', '1.0.2').length, 0);
const files = new Map(), writes = [];
let failWrite = false;
const adapter = { exists: async p => files.has(p), read: async p => files.get(p), write: async (p, value) => { if (failWrite) throw Error('disk'); writes.push(p); files.set(p, value); } };
const app = { vault: { configDir: '.obsidian', adapter }, workspace: { onLayoutReady: run => run() } };
function plugin(id, version = '1.0.2') {
  return { app, manifest: { id, name: id, version }, commands: [], cleanups: [],
    addCommand(command) { this.commands.push(command); }, register(cleanup) { this.cleanups.push(cleanup); } };
}
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const tick = async () => { for (const run of [...timers.values()]) run(); await settle(); };
const metadata = id => `.obsidian/plugins/${id}/update-notes.json`;
const p = plugin('first'); const controller = new UpdateNotes(p, entries); await settle(); await tick();
assert.equal(dialogs.length, 1); assert.equal(dialogs[0].contentEl.children.filter(el => el.tag === 'section').length, 2);
assert.equal(JSON.parse(files.get(metadata('first'))).seenVersion, '1.0.2');
assert.equal(p.commands[0].id, 'view-update-notes');
// The opt-out races with the initial seen-version save: both fields must survive.
const findInput = el => el.tag === 'input' ? el : el.children.map(findInput).find(Boolean);
const checkbox = findInput(dialogs[0].contentEl); checkbox.checked = false; checkbox.events.change(); await settle();
assert.equal(JSON.parse(files.get(metadata('first'))).autoShow, false);
assert.equal(JSON.parse(files.get(metadata('first'))).seenVersion, '1.0.2');
dialogs[0].close(); await tick();
new UpdateNotes(plugin('first'), entries); await settle(); assert.equal(dialogs.length, 0);
blocked = true; controller.show(); await settle(); await tick(); assert.equal(dialogs.length, 1); dialogs[0].close(); blocked = false; await tick();
files.set(metadata('same'), JSON.stringify({ seenVersion: '1.0.2', autoShow: true }));
new UpdateNotes(plugin('same'), entries); await settle(); assert.equal(dialogs.length, 0);
files.set(metadata('downgrade'), JSON.stringify({ seenVersion: '2.0.0', autoShow: true }));
new UpdateNotes(plugin('downgrade'), entries); await settle(); assert.equal(dialogs.length, 0);
blocked = true;
const queued = plugin('queued'); new UpdateNotes(queued, entries); await settle();
const second = plugin('second'); new UpdateNotes(second, entries); await settle();
assert.equal(dialogs.length, 0); assert.equal(files.has(metadata('queued')), false);
queued.cleanups.forEach(run => run()); blocked = false; await tick();
assert.equal(dialogs.length, 1); assert.equal(dialogs[0].title.startsWith('second'), true);
assert.equal(files.has(metadata('queued')), false);
const third = plugin('third'); new UpdateNotes(third, entries); await settle(); assert.equal(dialogs.length, 1);
second.cleanups.forEach(run => run()); await tick(); assert.equal(dialogs.length, 1); assert.equal(dialogs[0].title.startsWith('third'), true);
dialogs[0].close(); await tick(); assert.equal(timers.size, 0);
files.set(metadata('corrupt'), 'untouched invalid json');
const corrupt = new UpdateNotes(plugin('corrupt'), entries); await settle(); assert.equal(dialogs.length, 0); assert.equal(files.get(metadata('corrupt')), 'untouched invalid json');
corrupt.show(); await settle(); await tick(); assert.equal(dialogs.length, 1); assert.equal(files.get(metadata('corrupt')), 'untouched invalid json'); dialogs[0].close(); await tick();
notices.length = 0;
failWrite = true; new UpdateNotes(plugin('failure'), entries); await settle(); await tick(); assert.equal(notices.length, 1); assert.equal(files.has(metadata('failure')), false); dialogs[0].close(); await tick();
assert.equal(writes.every(p => p.endsWith('/update-notes.json')), true);
const manifest = JSON.parse(readFileSync('manifest.json'));
const release = readFileSync(`${dir}/update-notes-release.ts`, 'utf8'); assert.ok(release.includes(`version: '${manifest.version}'`));
const translations = await build({ entryPoints: [`${dir}/update-notes-i18n.ts`], bundle: true, write: false, format: 'cjs', external: ['obsidian'] });
const translated = { module: { exports: {} }, require: context.require }; vm.runInNewContext(translations.outputFiles[0].text, translated);
for (const locale of translated.module.exports.UPDATE_LOCALES) for (const key of ['title', 'view', 'done', 'automatic', 'saveError', 'introduced', 'revisit', 'control', 'fallback']) assert.ok(translated.module.exports.updateText(locale, key));
assert.equal(translated.module.exports.updateText('zh-Hant', 'title'), '更新內容');
assert.equal(translated.module.exports.updateText('unknown', 'title'), 'What’s new');
console.log('Update notes passed: versions, skipped updates, once-only, opt-out, manual reopen, queue, unload, corrupt data, write errors, isolated storage, all locales, release version.');
