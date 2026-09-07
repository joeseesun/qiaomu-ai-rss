# Changelog

## 0.10.0 — 2026-09-07

- Default selection popup off and add an immediate settings toggle, independent of text dragging.
- Add original-source links alongside Daily Note reader-return links.
- Expose font, size, line-height and measure in settings; anchor the reader panel to the sticky toolbar.
- Read selected vault Markdown folders and descendants with native folder typeahead, Markdown rendering, attachments and internal links. Local sources never call the Qiaomu API.

## 0.9.1 — 2026-09-07

- Encode vault-name spaces as %20 for Obsidian protocol routing; repair legacy links when rendered or appended.
- Drag selected article text into an editable note as safe plain Markdown, without source-link duplication or HTML.
- Group repeated captures under one article title, including interleaved article captures.

## 0.9.0 — 2026-09-07

- Remove Baoyu from featured feeds; keep existing subscriptions.
- Capture selected article text using an explicit selection popup.
- Append ordinary paragraphs and vault-scoped internal article links to Daily Notes.
- Retain captured article snapshots for offline return links, independent of recent cache.

## 0.8.1 — 2026-09-07

- Move reading appearance to the right-hand article actions.
- Preserve reader keyboard focus when toolbar or list controls are rebuilt, accept J/K in either case, and render fetched articles without waiting for settings persistence.
- Keep opened entries in the current unread session so Previous can return to them.
- Verify rapid navigation during delayed requests, stale-response protection, and preservation of Daily Note editor focus.

## 0.8.0 — 2026-09-07

- Bundle Source Han Serif, Source Han Sans, LXGW WenKai Screen, LXGW ZhenKai and Zhuque Fangsong for offline reading.
- Offer all five fonts alongside the existing system choices, loading them on demand and preserving article content and saved settings.
- Include complete SIL OFL notices in three-file releases.

## 0.7.0 — 2026-09-07

- Replace the flat channel search with a grouped picker, source icons, monograms, counts and cleaner active-channel labels.
- Show locally cached list thumbnails from API images, Media RSS, enclosures or article content.
- Replace standalone article exports with a deduplicated title-and-URL entry in today's Daily Note, then open that note in a desktop split.
- Continue the project-wide Obsidian UI rule: no hover tooltips unless explicitly requested.

## 0.6.0 — 2026-09-07

- Add compact, persistent reading controls for serif/sans fonts, text size, line height and article width.
- Apply typography changes immediately without recreating the article or losing its scroll position.
- Remove hover overlays triggered by accessibility attributes while retaining screen-reader text and keyboard behavior.

## 0.5.0 — 2026-09-07

- Replace the broad featured catalog with 10 high-signal Chinese authors and independent publications using verified direct feeds.
- Show the curation standard in Explore and move RSSHub routes into their own tab.
- Correct the duplicated hecaitou.com link by using 阮一峰's official Atom feed separately from 和菜头's feed.

## 0.4.0 — 2026-09-07

- Open a newly added discovery subscription in the reader automatically and remember that channel across reloads.
- Keep Qiaomu Blog as a built-in service channel and remove its duplicate discovery subscription card.

## 0.3.0 — 2026-09-07

- Fix clipped input focus borders with an inset ring in subscription dialogs.
- Add a native discovery tab with 12 featured feeds, RSSHub filtering and a configurable instance.
- Bundle 1,342 independent Chinese blogs from the MIT-licensed community directory, with local search, topic filters and paginated browsing.
- Validate one-click subscriptions, show existing/pending/retry states, and retain the current reading view.

## 0.2.0 — 2026-09-07

- Add vault-local RSS/Atom subscriptions, name/group editing, and unsubscribe while retaining favorites and notes.
- Preview and deduplicate OPML imports; export personal subscriptions into the vault.
- Read personal originals with the existing image cache, read/favorite filters and note export, without Qiaomu API requests.
- Preserve subscription data when switching Qiaomu service origins; bound feed caches and retain articles after refresh failures.

## 0.1.0 — 2026-09-07

- Native Qiaomu RSS reader with channel history, local search and read/favorite filters.
- Original, Chinese rewrite and translation reading modes using published API assets.
- Vault-local read state, favorite article snapshots and recent article cache.
- Safe Markdown export with provenance and preservation of existing notes.
- Sanitized article rendering, local image caching, adjustable list width, focused reading, precise Lucide icons and narrow-pane layout.
