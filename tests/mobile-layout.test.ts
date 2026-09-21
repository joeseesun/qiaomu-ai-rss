import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('phone reader layout', () => {
  it('keeps the phone status-bar inset without the hidden host header gap', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-header\s*{[^}]*display: none;/);
    expect(css).toMatch(/\.is-phone \.mod-root \.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-content\s*{[^}]*margin-top:max\(var\(--safe-area-inset-top,0px\),env\(safe-area-inset-top,0px\)\);/);
    expect(css).toMatch(/\.is-phone \.qrs-sidebar-toolbar \.qrs-channel\s*{[^}]*min-height:44px;/);
    expect(css).toMatch(/\.is-phone \.qrs-sidebar-toolbar \.qrs-icon\s*{[^}]*width:44px; height:44px;/);
  });
});
