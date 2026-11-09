// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
const modal = vi.hoisted(() => ({ action: undefined as undefined | (() => Promise<void>), description: '', open: vi.fn() }));
vi.mock('obsidian', async original => ({ ...await original<object>(), Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {}, TFile: class {}, Notice: vi.fn(class {}), Platform: { isDesktopApp: false, isMobileApp: false } }));
vi.mock('../src/subscription-ui', () => ({ ConfirmAction: class { constructor(_plugin: unknown, _title: string, description: string, action: () => Promise<void>) { modal.description = description; modal.action = action; } open() { modal.open(); } } }));
import { ReaderView } from '../src/view';
import { SaveQueue } from '../src/save-queue';

it('confirms before marking only the loaded list and persists once', async () => {
  const plugin = { state: { readIds: ['old', 'already'] }, persist: vi.fn(async () => {}) };
  const view = Object.assign(Object.create(ReaderView.prototype), { plugin, visibleEntries: () => [{ id: 'already' }, { id: 'loaded' }], unreadSession: new Set(['loaded']), renderList: vi.fn(), renderReader: vi.fn() });
  view.confirmMarkAllRead();
  expect(modal.open).toHaveBeenCalled();
  expect(plugin.state.readIds).toEqual(['old', 'already']);
  await modal.action!();
  expect(plugin.state.readIds).toEqual(['old', 'already', 'loaded']);
  expect(plugin.persist).toHaveBeenCalledOnce();
  expect(view.renderList).toHaveBeenCalledOnce();
});

it('handles an empty list and surfaces persistence failures', async () => {
  const queue = new SaveQueue(async () => { throw new Error('save failed'); });
  const plugin = { state: { readIds: ['old'] }, persist: (rollback?: () => void) => queue.request(rollback) };
  const view = Object.assign(Object.create(ReaderView.prototype), { plugin, visibleEntries: () => [], unreadSession: new Set(), renderList: vi.fn(), renderReader: vi.fn() });
  view.confirmMarkAllRead();
  await expect(modal.action!()).rejects.toThrow('save failed');
  expect(plugin.state.readIds).toEqual(['old']);
  expect(view.renderList).not.toHaveBeenCalled();
});

it('warns and retains only 5000 IDs for a larger list', async () => {
  const entries = Array.from({ length: 5001 }, (_, i) => ({ id: `entry-${i}` }));
  const plugin = { state: { readIds: ['old'] }, persist: vi.fn(async () => {}) };
  const view = Object.assign(Object.create(ReaderView.prototype), { plugin, visibleEntries: () => entries, unreadSession: new Set(), renderList: vi.fn(), renderReader: vi.fn() });
  view.confirmMarkAllRead();
  expect(modal.description).toContain('5000');
  expect(plugin.state.readIds).toEqual(['old']);
  await modal.action!();
  expect(plugin.state.readIds).toHaveLength(5000);
  expect(plugin.state.readIds).not.toContain('entry-0');
  expect(plugin.state.readIds).toContain('entry-5000');
});

it('preserves a concurrent addition while rolling back a failed batch', async () => {
  const state = { readIds: ['old'] };
  let reject!: (error: Error) => void;
  let onDisk = state.readIds;
  const write = vi.fn<() => Promise<void>>()
    .mockImplementationOnce(() => new Promise<void>((_, r) => { reject = r; }))
    .mockImplementation(async () => { onDisk = [...state.readIds]; });
  const queue = new SaveQueue(write);
  const plugin = { state, persist: (rollback?: () => void) => queue.request(rollback) };
  const view = Object.assign(Object.create(ReaderView.prototype), { plugin, visibleEntries: () => [{ id: 'batch' }], unreadSession: new Set(), renderList: vi.fn(), renderReader: vi.fn() });
  view.confirmMarkAllRead();
  const failure = expect(modal.action!()).rejects.toThrow('save failed');
  await Promise.resolve(); // The failed batch is already writing when the next change arrives.
  state.readIds = [...state.readIds, 'concurrent'];
  const saved = plugin.persist();
  reject(new Error('save failed'));
  await Promise.all([failure, saved]);
  expect(state.readIds).toEqual(['old', 'concurrent']);
  expect(onDisk).toEqual(state.readIds);
});

it('restores previous state when persistence fails', async () => {
  const queue = new SaveQueue(async () => { throw new Error('save failed'); });
  const plugin = { state: { readIds: ['old'] }, persist: (rollback?: () => void) => queue.request(rollback) };
  const view = Object.assign(Object.create(ReaderView.prototype), { plugin, visibleEntries: () => [{ id: 'new' }], unreadSession: new Set(), renderList: vi.fn(), renderReader: vi.fn() });
  view.confirmMarkAllRead();
  await expect(modal.action!()).rejects.toThrow('save failed');
  expect(plugin.state.readIds).toEqual(['old']);
});
