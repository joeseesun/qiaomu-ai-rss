# Privacy policy

Effective: 2026-09-07 (0.4.0). Maintainer: 向阳乔木, [GitHub](https://github.com/joeseesun).

Qiaomu AI RSS is a local reader for a remote Qiaomu RSS API. It requests public sources, entry lists, article details, and existing translation/rewrite assets. The default server is `rss.qiaomu.ai`. A user-configured server is governed by its own operator's policy.

The plugin sends no vault files, local searches, read states or favorites to that API. It has no analytics SDK, tracking identifier, account login or model-provider credentials. The API operator and hosting infrastructure can see standard connection/request metadata, including IP addresses and requested paths, and may retain operational access and error logs. This release does not claim that the service is log-free; server log retention is not controlled by the plugin.

Images are enabled by default and can be disabled in settings. Raster images are downloaded through Obsidian, validated, and stored in this plugin’s image-cache folder inside the vault configuration (up to 64 MB / 100 files; 8 MB per image). The interface displays local Blob URLs and can reuse cached images offline. Third-party hosts see initial/retry image requests, and exported Markdown retains the original remote image URLs. SVG and executable payloads are not rendered. External links opened deliberately are governed by the destination sites' privacy policies.

Local settings, read IDs, entries and cached/favorite article bodies reside in the vault configuration's plugin folder, using Obsidian's storage API. Exported Markdown resides in the chosen vault folder. Your configured sync/backup service may copy these files. The plugin neither encrypts local data nor reads files outside the vault.

To remove local reader data, disable the plugin and remove its `data.json` and `image-cache/` folder in the vault's configured plugin directory. Previously exported notes remain under your control. Removing plugin data does not remove service access logs. Contact the maintainer through GitHub for privacy questions; do not post private data or credentials in public issues.

## Personal subscriptions

Personal RSS/Atom URLs are fetched directly through Obsidian's HTTP(S) API, without a Qiaomu proxy, account or AI generation. Hosts receive normal connection metadata. Adding a source fetches and validates it; selecting a personal channel refreshes caches older than five minutes; the refresh button forces a request. A batch uses up to three workers. No periodic polling is registered. Requests already initiated may finish after a view closes.

OPML imports are previewed and stored locally without fetching feeds at import time. Exports create an OPML file in the configured vault notes folder. URLs, names, groups, cached feed articles, errors and update times are saved in plugin data. Feed URLs with query tokens may grant access to private content; plugin data and OPML exports are unencrypted and should not be shared publicly. URL-embedded usernames/passwords are not accepted.

Canceling a subscription removes its list/cache, but keeps favorited article snapshots and exported notes. Switching the Qiaomu service origin preserves personal subscriptions and favorites. Removing plugin data removes subscriptions; separately exported OPML files and notes remain.

## Discovery and RSSHub

The bundled catalog is read locally. Search terms, topic filters and browsing behavior are not sent to GitHub, Qiaomu, RSSHub or the blogs. There are no remote favicons or live catalog requests. Clicking Subscribe fetches the selected feed. RSSHub routes use the displayed instance (default `https://rsshub.rssforever.com`, operated by a third party); it sees the requested route and standard request metadata, and obtains content from upstream sites. Users can configure another HTTPS instance. The plugin never silently switches providers, and previously saved feed URLs are unchanged. Clicking a blog home-page or catalog-source link opens that destination in the browser.
