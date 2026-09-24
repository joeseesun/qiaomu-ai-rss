# Privacy policy

Effective: 2026-09-07 (0.11.0). Maintainer: 向阳乔木, [GitHub](https://github.com/joeseesun).

Qiaomu AI RSS is a local reader for a remote Qiaomu RSS API. It requests public sources, entry lists, article details, and existing translation/rewrite assets. The default server is `rss.qiaomu.ai`. A user-configured server is governed by its own operator's policy.

Podcast entries may include a direct HTTPS audio URL. The player does not preload audio; playing it contacts the media host. YouTube links are recognized only from supported YouTube domains. Opening a YouTube article creates a restricted YouTube iframe preview without autoplay; YouTube can receive normal connection metadata and its embedded player runs its own scripts before playback. Switching articles or closing the reader unloads the active media. If playback is blocked, users can deliberately open the original link in a browser.

The plugin sends no vault files, local searches, read states or favorites to that API. It has no analytics SDK, tracking identifier, account login or model-provider credentials. The API operator and hosting infrastructure can see standard connection/request metadata, including IP addresses and requested paths, and may retain operational access and error logs. This release does not claim that the service is log-free; server log retention is not controlled by the plugin.

Images are enabled by default and can be disabled in settings. Raster article images and list thumbnails are downloaded through Obsidian, validated, and stored in this plugin’s image-cache folder inside the vault configuration (up to 64 MB / 100 files; 8 MB per image). The interface displays local Blob URLs and can reuse cached images offline. Third-party hosts see initial/retry image requests. SVG and executable payloads are not rendered. External links opened deliberately are governed by the destination sites' privacy policies.

Opening the About settings tab loads the reward and public-account QR images from `radio.qiaomu.ai`. That host sees ordinary image request metadata. These images are not requested during article reading.

Local settings, read IDs, entries and cached/favorite article bodies reside in the vault configuration's plugin folder, using Obsidian's storage API. The note action reads the core Daily Notes configuration and appends the article title and a vault-scoped internal reader link, plus explicitly selected text when requested to today's note, creating it from the configured template when needed. Captured article snapshots remain in plugin data independently of the recent cache, allowing internal links to reopen the saved reading version offline. Deleting plugin data breaks those internal links; note text remains. No selections or notes are transmitted. Your configured sync/backup service may copy these files. The plugin neither encrypts local data nor reads files outside the vault.

To remove local reader data, disable the plugin and remove its `data.json` and `image-cache/` folder in the vault's configured plugin directory. Daily Notes and exports remain under your control. Removing plugin data does not remove files you explicitly exported or service access logs. Contact the maintainer through GitHub for privacy questions; do not post private data or credentials in public issues.

## Personal subscriptions

Personal RSS/Atom URLs are fetched directly through Obsidian's HTTP(S) API, without a Qiaomu proxy, account or AI generation. Hosts receive normal connection metadata. Adding a source fetches and validates it; selecting a personal channel refreshes caches older than five minutes; the refresh button forces a request. A batch uses up to three workers. No periodic polling is registered. Requests already initiated may finish after a view closes.

OPML imports are previewed and stored locally without fetching feeds at import time. Exports create an OPML file in the configured vault export folder. URLs, names, groups, cached feed articles, errors and update times are saved in plugin data. Feed URLs with query tokens may grant access to private content; plugin data and OPML exports are unencrypted and should not be shared publicly. URL-embedded usernames/passwords are not accepted.

Canceling a subscription removes its list/cache, but keeps favorited article snapshots and links already added to Daily Notes. Switching the Qiaomu service origin preserves personal subscriptions and favorites. Removing plugin data removes subscriptions; Daily Notes and separately exported OPML files remain.

## Discovery and RSSHub

Featured feeds, ten podcast recommendations, and the independent blog catalog are read locally. Their local search terms and filters are not sent to catalog providers. Opening or searching the WeChat tab requests the public catalog from the configured Qiaomu Reader service; online podcast search sends the entered term to that service. Following a podcast reads episodes and available source transcripts; registered Reader sources can also expose existing rewrites. Subscribing does not request AI generation. The service receives ordinary request metadata. The plugin loads no remote favicons and does not fetch individual personal RSS feeds until Subscribe is clicked. Existing user subscriptions retain their saved URLs. Clicking a blog home-page or catalog-source link opens that destination in the browser.

## Vault Markdown folders

Only explicitly selected vault folders (including their descendants) are listed as local Markdown sources. File names, modification times and frontmatter are used locally; bodies are read when opened and recent/favorite/captured snapshots remain in plugin data. They are never sent to Qiaomu. Removing a folder source does not delete files or existing saved snapshots. Native Obsidian Markdown rendering resolves internal links and attachments and follows native/plugin rendering behavior, including requests for remote embeds present in the selected note. The RSS image-cache setting applies to RSS HTML, not native Markdown embeds.

The selection popup is disabled by default. Turning it on and typography preferences are stored in the vault plugin settings.

Dragging an image transfers its local raster bytes to Obsidian. Dropping into a note uses native attachment handling and the configured attachment location; it creates a normal vault attachment, which is independent of the RSS image cache. Native Markdown attachment bytes may be read locally to prepare a drag. Canceling a drag does not create an attachment.

## Personal library and discovery (0.20.0)

RSS, followed podcasts and chosen vault paths share local grouping metadata. Group changes never publish subscriptions to Qiaomu Picks or change public source catalogs. Upgrading a pre-library data file creates `data-before-library-v1.json` beside `data.json`; it contains the same private URLs as the original file and is kept for manual rollback. Removing a local source only removes its reading subscription; it does not delete vault files.

The Tidings metadata snapshot is bundled for offline discovery (CC0-1.0) and ships with plugin updates; discovery makes no catalog download of its own. A `tidings-catalog.json` cached by an earlier version is read only while it is newer than the bundled snapshot. Online OPML import requests the user-provided URL. Imports are previewed and selected before being stored; feed bodies are not downloaded by import itself. Searching online WeChat/podcast catalogs sends search terms to the configured Qiaomu service. Selecting Preview requests that feed or podcast's recent entries.

When remote images are enabled, visible source avatars and publisher favicons are fetched and cached by the existing local image service. No third-party favicon lookup service receives the subscription list. Missing icons fall back to text. Automatic batches refresh at most 20 RSS sources with 3 concurrent requests; local folders and remote podcasts are opened explicitly.

## Saving articles (0.20.0)

存为笔记 writes the current article version into the vault folder chosen in settings (default `Qiaomu RSS/文章`) using Obsidian's vault API. Images already shown by the reader are copied from the local image cache into the vault attachment location configured in Obsidian; images that cannot be saved keep their original web link. The plugin stores a local map from article ID and version to the saved note path so the toolbar can open that note; it follows renames and is never sent anywhere. PDF export on desktop uses the system save dialog and remembers the last chosen directory in plugin settings.

