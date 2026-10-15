/** Variable-height window. Prefix sums keep far scrolling independent of article count. */
export class ListWindow {
  private ids: string[] = [];
  private positions = new Map<string, number>();
  private sizes = new Map<string, number>();
  private tree = new Float64Array(1);
  private heights: number[] = [];
  constructor(private estimate = 130) {}
  setItems(ids: string[]) {
    if (ids.length === this.ids.length && ids.every((id, i) => id === this.ids[i])) return;
    this.ids = ids; this.positions = new Map(ids.map((id, i) => [id, i]));
    this.sizes = new Map([...this.sizes].filter(([id]) => this.positions.has(id)));
    this.tree = new Float64Array(ids.length + 1);
    this.heights = ids.map(id => this.sizes.get(id) || this.estimate);
    for (let i = 1; i < this.tree.length; i++) {
      this.tree[i] += this.heights[i - 1];
      const parent = i + (i & -i); if (parent < this.tree.length) this.tree[parent] += this.tree[i];
    }
  }
  private add(index: number, delta: number) { for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta; }
  offset(index: number) { let value = 0; for (let i = Math.min(index, this.ids.length); i > 0; i -= i & -i) value += this.tree[i]; return value; }
  get total() { return this.offset(this.ids.length); }
  indexAt(top: number) {
    let lo = 0, hi = this.ids.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.offset(mid + 1) <= top) lo = mid + 1; else hi = mid; }
    return Math.min(lo, Math.max(0, this.ids.length - 1));
  }
  idAt(index: number) { return this.ids[index]; }
  position(id: string) { return this.positions.get(id); }
  measure(id: string, height: number) {
    const index = this.positions.get(id);
    if (index === undefined || height <= 0 || Math.abs(this.heights[index] - height) < 0.5) return false;
    this.add(index, height - this.heights[index]); this.heights[index] = height; this.sizes.set(id, height); return true;
  }
  range(top: number, viewport: number) {
    const start = Math.max(0, this.indexAt(Math.max(0, top)) - 6);
    const end = Math.min(this.ids.length, Math.max(start + 1, this.indexAt(top + viewport) + 7));
    return { start, end, before: this.offset(start), after: this.total - this.offset(end) };
  }
  clearMeasurements() { const ids = this.ids; this.ids = []; this.sizes.clear(); this.setItems(ids); }
}
