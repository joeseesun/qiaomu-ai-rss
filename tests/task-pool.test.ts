import { describe, expect, it } from 'vitest';
import { TaskPool } from '../src/task-pool';
describe('real transport admission', () => {
  it('retains occupied slots until transport settles and skips stale queued work', async () => {
    const pool = new TaskPool(1); let release!: (value: number) => void;
    const first = pool.run(() => new Promise<number>(resolve => { release = resolve; }));
    let calls = 0, current = true;
    const stale = pool.run(async () => ++calls, () => current).catch(() => -1);
    await Promise.resolve(); current = false; expect(calls).toBe(0);
    release(1); expect(await first).toBe(1); expect(await stale).toBe(-1); expect(calls).toBe(0);
    expect(await pool.run(async () => 2)).toBe(2);
  });
});
it('reserves a slot for foreground reading while background requests are stalled', async () => {
  const pool = new TaskPool(3), releases: (() => void)[] = [];
  const background = Array.from({ length: 3 }, () => pool.run(() => new Promise<void>(resolve => releases.push(resolve)), () => true, 1));
  await Promise.resolve(); expect(releases).toHaveLength(2);
  expect(await pool.run(async () => 'Readable now')).toBe('Readable now');
  releases[0](); await new Promise(resolve => setTimeout(resolve, 0)); expect(releases).toHaveLength(3);
  releases[1](); releases[2](); await Promise.all(background);
});
