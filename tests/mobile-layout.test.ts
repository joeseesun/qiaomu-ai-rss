import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('phone reader layout', () => {
  it('removes the hidden host header spacing without adding another safe-area gap', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-header\s*{[^}]*display: none;/);
    expect(css).toMatch(/\.is-phone \.mod-root \.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-content\s*{[^}]*margin-top:0;/);
  });
});
