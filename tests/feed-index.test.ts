import { expect, it } from 'vitest';
import { FeedIndex } from '../src/feed-index';
import { subscriptionSchema } from '../src/model';
it('reuses unchanged timelines and merges changed sources without losing the other sources', () => {
  const feed = (id: string, date: number) => subscriptionSchema.parse({ id, name: id, url: 'https://example.com', entries: [{ id: `${id}-${date}`, sourceId: id, title: id, publishedTs: date }] });
  const index = new FeedIndex(), a = feed('a', 2), b = feed('b', 1);
  const first = index.update([a, b]); expect(index.update([a, b])).toBe(first);
  const changed = feed('b', 3); expect(index.update([a, changed]).map(entry => entry.id)).toEqual(['b-3', 'a-2']);
  expect(index.update([a]).map(entry => entry.id)).toEqual(['a-2']);
});
