import { expect, it, vi } from 'vitest';
import { SaveQueue } from '../src/save-queue';
it('100 simultaneous saves write once and do not resolve before durable completion', async () => {
  let finish!: () => void;
  const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const saves = new SaveQueue(write);
  const done = vi.fn(); const batch = Promise.all(Array.from({length:100}, () => saves.request())).then(done);
  await Promise.resolve(); expect(write).toHaveBeenCalledOnce(); expect(done).not.toHaveBeenCalled();
  finish(); await batch; expect(done).toHaveBeenCalledOnce();
});
it('changes arriving during a write get their own batch and failure does not poison later saves', async () => {
  let fail!: (error: Error) => void;
  const writes = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
  const saves = new SaveQueue(writes);
  const first = saves.request().catch(error => error.message); await Promise.resolve();
  const next = Array.from({length:20}, () => saves.request());
  fail(new Error('disk full')); expect(await first).toBe('disk full'); await Promise.all(next);
  expect(writes).toHaveBeenCalledTimes(2);
});
