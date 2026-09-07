# Validation — 0.1.0

Checked on 2026-09-07. This is an original plugin connected to the real public Qiaomu RSS API. The Obsidian checks use a disposable **Qiaomu RSS QA** vault, never a personal knowledge vault.

## Automated checks

`npm run check` passes TypeScript checking, the official `eslint-plugin-obsidianmd` recommended rules, 16 Vitest tests, and the production bundle build.

Tests exercise HTML/script and URL sanitization, safe vault paths, note frontmatter and source attribution, preventing executable remote code blocks, API validation/errors/timeouts, state round trips, raster image validation, disk-cache reuse and offline reads, per-image size limits, and disk-cache eviction. `npm audit` reports no known vulnerabilities at validation time.

`npm run test:live` makes read-only requests to the production public API. Source listing (60 sources), article lists/details, existing rewrite and translation payloads, channel filtering, and non-overlapping cursor pagination pass. Content counts and publication availability can change over time.

## Actual Obsidian desktop

Host: macOS; Obsidian 1.13.7. The plugin was built, installed, enabled, reloaded, and operated inside Obsidian. `node scripts/obsidian-smoke.mjs` passes 13 checks:

- Load 100 real entries, open an article, and render the rewrite.
- Favorite, filter favorites, and retain favorites after plugin reload.
- Display original content and explicit handling of missing translation.
- Save through the toolbar; repeated and concurrent exports preserve edits in the existing note.
- Render a cached article when the article request fails.
- Load older channel entries (40 to 80) through cursor pagination.
- Keep the latest article selected when an older request completes later.
- Resize the article list using the accessible separator's keyboard controls.

Additional actual UI checks cover dragging the divider (340 to 420 pixels), native channel search and selection, focused reading with the same article/image DOM retained and scroll position preserved, and compact layout in light and dark themes. At 390 pixels, the article screen has a 52px toolbar, hides the list, and has no horizontal overflow or clipped toolbar actions. This is a desktop narrow-pane check, not a mobile-device test.

A real article image renders with a `blob:app://obsidian.md/…` local URL and nonzero natural dimensions (1558px width), backed by a file in this plugin's image cache. The desktop screenshot in this repository is from the running plugin, not a mockup. Obsidian's developer error list is empty at the end of acceptance.

## Reproduction and limits

1. Build with `npm ci && npm run check`.
2. Install the three release files into a disposable vault named `Qiaomu RSS QA`, enable the plugin, and open its reader.
3. Run `node scripts/obsidian-smoke.mjs`. It changes local favorites/read state and creates/edits test notes. Its report is written to `artifacts/obsidian-smoke.json` (ignored by Git). Use `RSS_TEST_VAULT` only with another disposable vault.

No physical iOS or Android device was tested. The runtime uses Obsidian and Web APIs without Node.js/Electron dependencies; this supports `isDesktopOnly: false`, but does not establish mobile-device acceptance. The declared minimum is Obsidian 1.13.0; the installed desktop version tested is 1.13.7.

Offline behavior is limited to already-cached lists, articles and images. Public reading state does not synchronize with website/iOS accounts. Exported Markdown retains original remote image URLs. This release does not generate AI content. Community Directory submission and review remain separate from these tests.
