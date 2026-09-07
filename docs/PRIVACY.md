# Privacy policy

Effective: 2026-09-07 (0.11.0). Maintainer: 向阳乔木, [GitHub](https://github.com/joeseesun).

Qiaomu AI RSS is a local reader for a remote Qiaomu RSS API. It requests public sources, entry lists, article details, and existing translation/rewrite assets. The default server is `rss.qiaomu.ai`. A user-configured server is governed by its own operator's policy.

The plugin sends no vault files, local searches, read states or favorites to that API. It has no analytics SDK, tracking identifier, account login or model-provider credentials. The API operator and hosting infrastructure can see standard connection/request metadata, including IP addresses and requested paths, and may retain operational access and error logs. This release does not claim that the service is log-free; server log retention is not controlled by the plugin.

Images are enabled by default and can be disabled in settings. Raster article images and list thumbnails are downloaded through Obsidian, validated, and stored in this plugin’s image-cache folder inside the vault configuration (up to 64 MB / 100 files; 8 MB per image). The interface displays local Blob URLs and can reuse cached images offline. Third-party hosts see initial/retry image requests. SVG and executable payloads are not rendered. External links opened deliberately are governed by the destination sites' privacy policies.

Local settings, read IDs, entries and cached/favorite article bodies reside in the vault configuration's plugin folder, using Obsidian's storage API. The note action reads the core Daily Notes configuration and appends the article title and a vault-scoped internal reader link, plus explicitly selected text when requested to today's note, creating it from the configured template when needed. Captured article snapshots remain in plugin data independently of the recent cache, allowing internal links to reopen the saved reading version offline. Deleting plugin data breaks those internal links; note text remains. No selections or notes are transmitted. Your configured sync/backup service may copy these files. The plugin neither encrypts local data nor reads files outside the vault.

To remove local reader data, disable the plugin and remove its `data.json` and `image-cache/` folder in the vault's configured plugin directory. Daily Notes and OPML exports remain under your control. Removing plugin data does not remove service access logs. Contact the maintainer through GitHub for privacy questions; do not post private data or credentials in public issues.

## Personal subscriptions

Personal RSS/Atom URLs are fetched directly through Obsidian's HTTP(S) API, without a Qiaomu proxy, account or AI generation. Hosts receive normal connection metadata. Adding a source fetches and validates it; selecting a personal channel refreshes caches older than five minutes; the refresh button forces a request. A batch uses up to three workers. No periodic polling is registered. Requests already initiated may finish after a view closes.

OPML imports are previewed and stored locally without fetching feeds at import time. Exports create an OPML file in the configured vault export folder. URLs, names, groups, cached feed articles, errors and update times are saved in plugin data. Feed URLs with query tokens may grant access to private content; plugin data and OPML exports are unencrypted and should not be shared publicly. URL-embedded usernames/passwords are not accepted.

Canceling a subscription removes its list/cache, but keeps favorited article snapshots and links already added to Daily Notes. Switching the Qiaomu service origin preserves personal subscriptions and favorites. Removing plugin data removes subscriptions; Daily Notes and separately exported OPML files remain.

## Discovery and RSSHub

The bundled catalog is read locally. Search terms, topic filters and browsing behavior are not sent to GitHub, Qiaomu, RSSHub or the blogs. There are no remote favicons or live catalog requests. Clicking Subscribe fetches the selected feed. The website/WeChat service category and provider recommendations were removed in 0.16.0. Existing user subscriptions retain their saved URLs. Clicking a blog home-page or catalog-source link opens that destination in the browser.

## Vault Markdown folders

Only explicitly selected vault folders (including their descendants) are listed as local Markdown sources. File names, modification times and frontmatter are used locally; bodies are read when opened and recent/favorite/captured snapshots remain in plugin data. They are never sent to Qiaomu. Removing a folder source does not delete files or existing saved snapshots. Native Obsidian Markdown rendering resolves internal links and attachments and follows native/plugin rendering behavior, including requests for remote embeds present in the selected note. The RSS image-cache setting applies to RSS HTML, not native Markdown embeds.

The selection popup is disabled by default. Turning it on and typography preferences are stored in the vault plugin settings.

Dragging an image transfers its local raster bytes to Obsidian. Dropping into a note uses native attachment handling and the configured attachment location; it creates a normal vault attachment, which is independent of the RSS image cache. Native Markdown attachment bytes may be read locally to prepare a drag. Canceling a drag does not create an attachment.
