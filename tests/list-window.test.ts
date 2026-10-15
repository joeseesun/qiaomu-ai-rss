import { describe, expect, it } from 'vitest';
import { ListWindow } from '../src/list-window';
describe('bounded variable-height article window', () => {
  it('renders a bounded range near both ends of a 100000 article list', () => {
    const window = new ListWindow(100); window.setItems(Array.from({ length: 100000 }, (_, i) => String(i)));
    expect(window.range(0, 600).end).toBeLessThan(20);
    const far = window.range(9999000, 600);
    expect(far.start).toBeGreaterThan(99980); expect(far.end - far.start).toBeLessThan(20);
    expect(far.before + (far.end - far.start) * 100 + far.after).toBe(10000000);
  });
  it('preserves measured heights and locates a scroll anchor after inserting articles', () => {
    const window = new ListWindow(100); window.setItems(['a', 'b', 'c']);
    window.measure('a', 170); window.measure('b', 80);
    expect(window.indexAt(200)).toBe(1); expect(window.offset(2)).toBe(250);
    window.setItems(['new', 'a', 'b', 'c']);
    expect(window.offset(window.position('b')!)).toBe(270);
    window.setItems(['b']); expect(window.total).toBe(80);
    window.clearMeasurements(); expect(window.total).toBe(100);
  });
});
