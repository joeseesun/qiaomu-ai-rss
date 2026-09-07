# Validation — 0.8.0

Checked on 2026-09-07. This is an original plugin connected to the real public Qiaomu RSS API. The Obsidian checks use a disposable **Qiaomu RSS QA** vault, never a personal knowledge vault.

## Automated checks

`npm run check` passes TypeScript checking, the official `eslint-plugin-obsidianmd` recommended rules, 41 Vitest tests, and the production bundle build.

Tests exercise HTML/script and URL sanitization, safe vault paths, Daily Note path/link/template handling and duplicate prevention, preventing executable remote code blocks, API validation/errors/timeouts, state round trips, RSS/Atom thumbnail discovery, raster image validation, disk-cache reuse and offline reads, per-image size limits, and disk-cache eviction. `npm audit` reports no known vulnerabilities at validation time.

`npm run test:live` makes read-only requests to the production public API. Source listing (60 sources), article lists/details, existing rewrite and translation payloads, channel filtering, and non-overlapping cursor pagination pass. Content counts and publication availability can change over time.

## Actual Obsidian desktop

Host: macOS; Obsidian 1.13.7. The plugin was built, installed, enabled, reloaded, and operated inside Obsidian. `node scripts/obsidian-smoke.mjs` passes 18 checks:

- Load 100 real entries, open an article, and render the rewrite.
- Favorite, filter favorites, and retain favorites after plugin reload.
- Display original content and explicit handling of missing translation.
- Load list thumbnails through local Blob URLs.
- Group channels into aggregates, subscription groups, Qiaomu channels and personal feeds with icons or monograms and clean names.
- Append only the article title and URL to today's Daily Note, open it in a split, and prevent duplicate links on repeated use.
- Render a cached article when the article request fails.
- Load older channel entries (40 to 80) through cursor pagination.
- Keep the latest article selected when an older request completes later.
- Resize the article list using the accessible separator's keyboard controls.
- Change the article font, size, line height and measure live; retain those values after a plugin reload.
- Confirm that the reader contains no tooltip-triggering `aria-label` attributes while icon controls retain visually hidden accessible names.

Additional actual UI checks cover dragging the divider (340 to 420 pixels), grouped channel search and selection, focused reading with the same article/image DOM retained and scroll position preserved, and compact layout in light and dark themes. At 390 pixels, the article screen has a 52px toolbar, hides the list, and has no horizontal overflow or clipped toolbar actions. This is a desktop narrow-pane check, not a mobile-device test.

A real article image and 12 visible list thumbnails render with `blob:app://obsidian.md/…` local URLs and nonzero dimensions, backed by files in this plugin's image cache. The Daily Note appeared in a vertical split and contained a title link without copied article content or plugin frontmatter. The desktop screenshots in this repository are from the running plugin, not mockups. Obsidian's developer error list is empty at the end of acceptance.

## Reproduction and limits

1. Build with `npm ci && npm run check`.
2. Install the three release files into a disposable vault named `Qiaomu RSS QA`, enable the plugin, and open its reader.
3. Run `node scripts/obsidian-smoke.mjs`. It changes local favorites/read state and adds links to the test vault's Daily Note. Its report is written to `artifacts/obsidian-smoke.json` (ignored by Git). Use `RSS_TEST_VAULT` only with another disposable vault.

No physical iOS or Android device was tested. The runtime uses Obsidian and Web APIs without Node.js/Electron dependencies; this supports `isDesktopOnly: false`, but does not establish mobile-device acceptance. The declared minimum is Obsidian 1.13.0; the installed desktop version tested is 1.13.7.

Offline behavior is limited to already-cached lists, articles and images. Public reading state does not synchronize with website/iOS accounts. This release does not generate AI content. Community Directory submission and review remain separate from these tests.

## Personal subscriptions — 0.2.0

`node scripts/subscription-smoke.mjs` passes 14 further integration checks in the same real Obsidian 1.13.7 test vault (32 together with the reader suite):

- Add the live Reorx RSS feed (50 cached articles) and Simon Willison Atom feed (30 articles) through the subscription form; reject a duplicate URL. Qiaomu Blog is tested through its built-in service channel rather than as a personal subscription.
- Edit source name/group, choose a group, and render original personal articles while replacing the Qiaomu API method with a throwing guard.
- Export OPML through the UI into the vault; preview and import pasted OPML while skipping a duplicate and an unsafe URL. Import itself makes no feed requests.
- Favorite personal articles, add their title links to the Daily Note, retain entries on simulated offline refresh, unsubscribe through the confirmation dialog and keep the favorite readable.
- Prevent a late curated response from replacing the personal list; retain names/groups/cached entries after plugin reload.

The native file-input path was also tested with an OPML File object. Desktop and 390px viewport screenshots were visually inspected. The subscription dialog is 364px wide inside the 390px viewport, with controls inside its bounds. The reader occupies the 346px pane beside Obsidian's ribbon, has no horizontal overflow, and displays a real 1558px-wide source image using a local Blob URL. Both light and dark layouts were checked; device emulation is not physical mobile testing.

Additional unit coverage includes RSS/Atom/RDF parsing, relative XML bases and images, plain-text content escaping, stable per-feed IDs, payload bounds, malformed XML/DTD rejection, OPML grouping/escaping/deduplication, upgrade defaults, service-origin changes preserving personal data, timeout/cache fallback, deletion during refresh, and progressive refresh with shared in-flight requests.

The subscription smoke runner adds/removes its named public test sources, creates an OPML export, adds a Daily Note link, and changes test read/favorite state. Run it only in a disposable test vault. No production server or personal vault is modified by these checks.

## Subscription activation regression — 0.4.0

The Qiaomu RSS QA vault reproduced the reported state: CoolShell was stored under the Independent Blogs group with 15 cached articles while the reader remained on Qiaomu Picks. Version 0.4.0 removes the duplicate Qiaomu Blog discovery card because `qiaomu-blog` is already returned by the built-in service source list. A discovery subscription now becomes the reader's active channel and is stored as the last source.

The real Reorx discovery card fetched 50 articles and immediately changed the existing reader to that exact feed. A separate CoolShell check displayed all 15 cached articles, opened the first article as original content, then reloaded the plugin and reopened the reader; the CoolShell channel and 15 entries were restored. In 0.5.0, the featured discovery view contains exactly 10 direct feeds, displays its selection standard, and keeps the 2 RSSHub routes in a separate tab. The reader channel picker still contains the built-in Qiaomu Blog source. Obsidian reported no developer errors. The desktop and 390px layout checks passed with no horizontal overflow and complete inset focus rings.

The broader discovery smoke reached and passed the new Reorx activation assertion, then stopped when the third-party RSSHub 36kr endpoint timed out. This external endpoint result is not counted as a complete discovery-smoke pass for 0.4.0.

## Curated discovery — 0.5.0

All 10 featured URLs returned HTTP 200 on 2026-09-07 and were parsed with the plugin's production `parseFeed` function, yielding 3 to 50 cached entries per source. The test used the exact bundled URLs, including the redirect from `baoyu.io/feed.xml` to `s.baoyu.io/feed.xml`. No RSSHub route is present in the featured array.

The built plugin was installed and reloaded in Obsidian 1.13.7. The Explore view showed three distinct tabs (10 featured, 1,342 independent blogs, 2 RSSHub routes), displayed the curation standard, and had no horizontal overflow. Subscribing to the real Tw93 feed produced 12 entries and immediately made that exact feed the reader source. Obsidian reported no developer errors. The broader discovery smoke passed the new featured/blog separation and the real 36kr route, then stopped when the third-party RSSHub GitHub-trending route timed out; that external result is not counted as a full smoke pass.

## Discovery and focus regression — 0.3.0

`npm run check` passes 38 tests, TypeScript, official Obsidian lint (zero warnings), and the production build. New unit coverage checks the complete bundled catalog's safe URLs and unique IDs, combined local filters, independent-blog separation, RSSHub URL construction and upgrade/instance persistence behavior.

`node scripts/discovery-smoke.mjs` passes 14 new checks in actual Obsidian 1.13.7: local-only catalog opening; first-60/next-60 blog pagination; combined name/theme search and empty state; real Reorx subscription (50 cached entries); RSSHub-only filtering; real 36kr (20) and GitHub trends (18); invalid instance rejection; simulated HTTP 503 failure then live retry; disabled duplicate-add state; personal reading; inset input focus; and reopening the same exploration tab from subscription management. The initial GitHub request timed out; an explicit retry and the complete final run succeeded. No hidden provider fallback is used. The smoke script resets only its three named public sources and cleans its additions in this disposable vault.

`node scripts/discovery-layout.mjs` checks desktop and 390px narrow layouts with light/dark themes, both subscription URL and group inputs, no horizontal overflow, and the discovery search focus. Focus emulation is enabled during these checks so that background app windows still render real `:focus` CSS; it is disabled afterward, with viewport and theme restored. Screenshots are from the running Obsidian view. The entire purple focus border is visible on all sides; unlike the 0.2.0 screenshot, it is now inside the input box. Developer errors were empty.

The earlier reader and subscription integration records above are retained as versioned baseline evidence. The 0.3.0 run adds the discovery checks; it does not imply that all 1,342 blog feeds have been fetched. Individual blog URLs can be stale. See DISCOVERY.md for source provenance, live probes and limitations. No physical mobile-device tests were performed.

## Official directory — 2026-09-07

Version 0.4.0 completed the directory's automatic review and was published. The public listing displays an Add to Obsidian link, three uploaded desktop screenshots, and the correct repository/version. Anonymous HTTP readback confirms the listing is public. See [submission record](SUBMISSION.md) for non-blocking review recommendations.

## Bundled fonts

`node scripts/font-smoke.mjs` verifies all five embedded font faces load in Obsidian, are applied to article text, preserve the article DOM, and persist the selection. Font assets are byte-identical to the documented upstream files after gzip decompression. No font network requests are used. Mobile-device verification remains pending.
