# Public API contract

Default origin: `https://rss.qiaomu.ai`. HTTPS only. No authentication required by these public endpoints. Requests use Obsidian `requestUrl`; all plugin service calls are GET. No background polling or automatic server refresh/AI-generation requests.

| Endpoint | Response used |
| --- | --- |
| `/api/sources` | `{ sources: [{ id, name, enabled }] }` |
| `/api/entries?limit=100` | `{ entries: [...] }` |
| `/api/sources/:id/entries?limit=40&cursor=...` | `{ entries, hasMore, nextCursor }` |
| `/api/entry/:id` | `{ entry: { id, sourceId, title, titleZh, content, link, image, audio?, ... } }` |
| `/api/entry/:id/rewrite` | `{ rewrite: { title, body } | null }`, Markdown body |
| `/api/entry/:id/translation` | `{ translation: { content: [{ target, targetHtml }] } | null }` |

IDs and cursors are URL-encoded. Zod validates response shapes and strips unused fields. JSON error documents and non-2xx responses are never treated as article content. Requests have a 20-second UI timeout; Obsidian's request API does not expose cancellation, so the underlying network request may finish later. View-generation checks prevent stale responses from replacing a newer selection or writing into a closed/reset view.

A missing translation or rewrite is distinct from an endpoint failure. Optional asset failures retain the article and display a warning; when a rewrite is absent the reader falls back to the original. Entries are not filtered by rewrite readiness, so new podcast and video episodes remain visible. On network failure, an existing cached article remains readable. The default stream is capped at 100 articles; channel histories use the actual server cursor rather than guessed offsets. Local state is separate from the web/iOS account state.

This contract was checked against the live service and the native iOS API client. Run `npm run test:live` to repeat the read-only checks. The local web checkout may lag behind the deployed channel-pagination API.

## Personal feeds (0.2.0)

Personal feeds bypass the Qiaomu API. HTTP(S) GET requests through `requestUrl` are parsed as RSS 2.x, RSS 1.0/RDF or Atom 1.0 XML. Content goes through the existing HTML sanitizer and image cache. List thumbnails use Media RSS, image enclosures, Atom enclosures, then the first safe content image. HTTPS audio enclosures are stored separately and played with the native audio element; untrusted article HTML cannot inject its own player. Article IDs are SHA-256 hashes of normalized feed URL plus GUID/Atom ID (fallback: article link, then title/date), in a separate local namespace. Local articles never request Qiaomu rewrite/translation assets.

At most 100 subscriptions; 5 MB input XML; inspect the first 200 entries, retain at most 50 and about 1 MB per source; each body is limited to 100,000 characters with a visible truncation notice. XML DTD/entity declarations are rejected. Requests use a 20-second UI timeout and refreshes use up to three workers per batch; in-flight requests for the same feed are shared. Failure preserves cached entries. Importing OPML is additive and non-fetching; nested group names become paths and duplicate normalized URLs are skipped.

Format references: [RSS specification](https://www.rssboard.org/rss-specification), [Atom RFC 4287](https://www.rfc-editor.org/rfc/rfc4287), [OPML 2.0](https://opml.org/spec2.opml).

## Load budget (0.27.4)

Public reads share at most four active transports per service client; channel/catalog work can occupy at most two, leaving room for the current article and its versions. A slow unresolved transport is never duplicated automatically. Settled connection failures and 408/502/504 may retry once after 1–2 seconds of jitter, with at most two automatic retries per client in a rolling 30 seconds. 429/503 cool down the client for at least 10 seconds, honoring a longer Retry-After. Three consecutive transient failures also trigger cooling. The 20-second deadline includes queue time; timed-out transports retain their slot until the host settles them. Unload/base changes discard queued work. No article prefetch was added.

List requests send `X-Rss-List: reader-v1`. Supporting servers omit unused asset statistics, signals and original bodies from lists, retaining all reader fields and pagination. Older servers can ignore the header and return the original shape. Full article endpoints are unchanged.

The deployed primary uses the bounded middleware in `server/public-read-cache.cjs`: anonymous allowlisted GET routes only, at most 128 responses / 32 MiB, a 10-second TTL and 2 MiB per item. API mutations invalidate before/after execution and bypass the cache while active; cache/state/SQLite/WAL file identity and timestamps are checked on each access. Authentication, unknown query parameters, errors and cookie-bearing/private responses are not shared. Responses remain `Cache-Control: no-store` outside the origin; `X-Rss-Read-Cache` distinguishes hits/misses. Data writes may lower the hit ratio; no fixed capacity claim is made.
