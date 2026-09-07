# Public API contract

Default origin: `https://rss.qiaomu.ai`. HTTPS only. No authentication required by these public endpoints. Requests use Obsidian `requestUrl`; all plugin service calls are GET. No background polling or automatic server refresh/AI-generation requests.

| Endpoint | Response used |
| --- | --- |
| `/api/sources?ready=rewrite` | `{ sources: [{ id, name, enabled }] }` |
| `/api/entries?limit=100&ready=rewrite` | `{ entries: [...] }` |
| `/api/sources/:id/entries?limit=40&ready=rewrite&cursor=...` | `{ entries, hasMore, nextCursor }` |
| `/api/entry/:id` | `{ entry: { id, sourceId, title, titleZh, content, link, ... } }` |
| `/api/entry/:id/rewrite` | `{ rewrite: { title, body } | null }`, Markdown body |
| `/api/entry/:id/translation` | `{ translation: { content: [{ target, targetHtml }] } | null }` |

IDs and cursors are URL-encoded. Zod validates response shapes and strips unused fields. JSON error documents and non-2xx responses are never treated as article content. Requests have a 20-second UI timeout; Obsidian's request API does not expose cancellation, so the underlying network request may finish later. View-generation checks prevent stale responses from replacing a newer selection or writing into a closed/reset view.

A missing translation or rewrite is distinct from an endpoint failure. Optional asset failures retain the article and display a warning. On network failure, an existing cached article remains readable. The default stream is capped at 100 articles; channel histories use the actual server cursor rather than guessed offsets. Local state is separate from the web/iOS account state.

This contract was checked against the live service and the native iOS API client. Run `npm run test:live` to repeat the read-only checks. The local web checkout may lag behind the deployed channel-pagination API.
