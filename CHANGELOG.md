# Changelog

## 0.20.0 — local development candidate

- Add Discover subscriptions with six editorial recommendations and WeChat, podcast and independent-blog catalogs.
- Search the bundled 718-source Tidings catalog and existing catalogs; preview feeds and recent episodes before following. Preserve discovery context after subscribing.
- Unify RSS, OPML imports, podcasts and vault paths in My subscriptions with stable groups, rename/reorder/delete, multi-select moves and safe unsubscribe.
- Import OPML from files, text or URLs with selectable searchable previews and duplicate protection. Support up to 2000 RSS subscriptions with bounded refresh batches.
- Restructure the channel picker into 乔木精选 (全部精选 plus built-in group filters such as 微信公众号 and 小宇宙 that merge their channels' latest articles) and 我的订阅 (全部订阅, reading a whole group in one click, expandable groups, ungrouped sources).
- Add a 管理订阅 button beside the picker search that opens the 订阅中心 dialog with 订阅管理 and 发现订阅 tabs: search, type/error filters, collapsible groups with select-all, sticky bulk actions (move, refresh, unsubscribe), per-feed refresh/copy URL, update status, OPML import/export and catalog discovery in one place. Retire the standalone Discover/My subscriptions tabs and close them when a saved workspace restores them.
- Merge the blog and "more" catalogs into 独立博客和其他 with URL and site/title deduplication. Merge alias groups such as Podcasts and 播客, and merge groups renamed onto an existing name.
- Simplify Discover: drop language/topic filters and the manual catalog update; the bundled catalog ships with plugin updates and provenance moves to a small footnote. Redesign 订阅管理 around one toolbar row (search, type filter, a single 添加 menu holding discovery, local content, new group and OPML import/export); quiet group labels with inline empty-group hints; framed source icons; per-source update time, unread count and read errors on the right, swapped for refresh and manage actions on hover; checkboxes revealed on hover or while selecting, with a bottom bulk-action bar. New local sources stay ungrouped instead of creating a 本地文件 group. Indent picker groups and sources below 全部精选/全部订阅.
- 全部精选 mixes each featured Xiaoyuzhou show's latest episode into the timeline by publish date instead of pinning them above newer articles; an episode older than the loaded page waits until older pages load.
- Fix the discovery panel staying on top after switching back to 订阅管理.
- The reader toolbar trades the font button for 存为笔记 (file-plus); once an article is saved in the current version the button becomes 打开已存笔记 (file-check) and the ⋯ menu offers 另存一份笔记. Saved-note links follow renames and folder moves. 阅读设置 moves to the top of the ⋯ menu.
- Save as Markdown writes straight into a vault folder (设置 → 保存与导出 → 文章保存文件夹, default `Qiaomu RSS/文章`) through Obsidian's vault API, so it also works on mobile; images follow Obsidian's attachment location and link style, repeat saves become `(2)`, and the notice links to the new note. PDF export keeps the system dialog but reopens where the last PDF was saved.
- Tighten the article list: hide the repeated source name inside a single channel, prefer cached Chinese rewrites for excerpts, drop WeChat bylines, hide untranslated excerpts under Chinese titles (titles get up to three lines), larger 12/13/15px meta, excerpt and title text, a gutter unread dot, and 56px thumbnails.
- Adopt a black, white and gray palette across the reader, dialogs, discovery, library and settings instead of Obsidian's purple accent; redesign the source preview dialog.
- Add cached source favicons with text fallback, source links on article headings, and compact mobile-compatible discovery and management.
- Preserve legacy data with a migration backup; keep personal subscriptions separate from editorial Qiaomu Picks.

## 0.18.2 — 2026-09-07

- Use a calm sage article selection palette with separate dark-mode and hover states; preserve row density and remove the tinted inset frame.

## 0.18.1 — 2026-09-07

- Prevent duplicated settings tab bars when Obsidian reuses a setting row.
- Add rotating reading scenarios and keyboard shortcuts to the empty reader, with manual tip switching and stable redraws.

## 0.18.0 — 2026-09-07

- Reduce the offline reading font to a licensed 7,554-codepoint WOFF2 subset; use device fonts for other choices. Enforce a 5 MB asset budget and publish artifact attestations.
- Organize settings into Reading, Sources, Excerpts and About with author, help and issue links.
- Add consistent clear buttons to article, channel and discovery search fields.
- Add installed version, release notes and the native plugin update settings entry.
- Correct marketplace installation instructions after confirming automated review timeouts.

## 0.17.0 — 2026-09-07

- Replace the centered channel prompt with an anchored desktop picker and mobile bottom sheet. Group feeds under their subscription folders, with compact rows, search, keyboard navigation and current-channel checks.
- Persist each channel’s article, reading mode, list/body offsets, loaded pages and filter/search state in the vault. Restore on return and view reopening, including delayed content layout and interrupted article requests.
- Choosing the current channel only closes the picker. Restored channels keep their loaded list until explicit refresh.

## 0.16.0 — 2026-09-07

- Remove website/WeChat exploration, provider recommendations and RSSHub instance controls. Preserve existing personal subscriptions.
- Always open Daily Notes beside the reader; reuse an adjacent split rather than switching to a note in the same tab group.
- Add a plugin-settings gear on the right of the article filters.
- Remove source/date/version metadata above article titles.

## 0.15.0 — 2026-09-07

- Open captured article links directly in the reader from Reading View and Live Preview; load deferred reader tabs before navigating.
- Save dragged images to the native attachment folder and explicitly insert image embeds, including drags without native file payloads.
- Hide the redundant native header only in RSS reader panes.
- Rename RSSHub exploration to 网站与公众号 and add public WeChat RSS directory and self-hosted subscription guidance.

## 0.14.0 — 2026-09-07

- Name the reader command 打开乔木 RSS 阅读器.
- Apply and save typography immediately; dismiss on outside taps, without Done or Reset buttons.
- Preserve mobile native long-press selection and show capture actions after selection-handle changes.
- Use Obsidian native searchable channel suggestions with readable selection and hover colors.
- Combine personal subscriptions, embedded exploration and local sources in one tabbed manager. Native file/folder search can add individual Markdown files or recursive folders as reader sources.

## 0.13.0 — 2026-09-07

- Enable the selection popup by default with separate Daily Note and current-note icon actions and tooltips.
- Stop writing internal capture comments. Clean legacy comments when notes open or become active, and group excerpts using article links.
- Default new reading preferences and the reset action to bundled Zhuque Fangsong; use a Lucide tree for Qiaomu selections. Existing saved preferences remain respected.

## 0.12.0 — 2026-09-07

- Remove the service-address control from user settings.
- Right-click article content to append selected text or an article link to the most recently active note or today’s Daily Note. Preserve unsaved editor text and group repeated captures.
- Align article metadata with titles and summaries; refine selection backgrounds and thumbnail edges without changing row spacing or typography.

## 0.11.0 — 2026-09-07

- Drag loaded RSS and vault Markdown raster images into editable notes as native image files.
- Use Obsidian native attachment handling for configured folders, note-relative paths, filename conflicts and local embeds.

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
