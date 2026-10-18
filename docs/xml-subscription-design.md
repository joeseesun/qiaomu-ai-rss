# Unified RSS/XML and OPML subscription input

Implemented in 0.30.0, based on 0.29.2. Updated 2026-10-18.

## User flow

Management and discovery share one input with permanent “支持网站、RSS/XML 和 OPML 链接” guidance. Names keep their search behavior; resolve URLs on Enter or Add. One secondary file action, XML paste and file drop use the same result area. No format tabs or nested OPML dialogs.

- One verified RSS/Atom feed: add once, show its name and Undo. New direct subscriptions start ungrouped and can be moved through existing management actions.
- Website: verify declarative HTML head alternate links. Add a sole valid result directly; show choices when multiple candidates exist or some candidates fail.
- OPML: preview inline with existing entries disabled and new entries selected. Retain groups. More than eight entries enables filtering and a select-filtered checkbox. Render 60 rows initially, with progressive expansion and filtering across the complete list. Confirm with one “Import N subscriptions” footer.
- Existing feed: show its name without replacing its name/group or writing another copy.
- Cancellation, edits, tab changes or closing invalidate pending reads. Saving has a commit-time guard and retains transactional rollback. Undo only removes unchanged subscriptions actually added by that operation; favorites and saved notes remain.

## Implementation boundaries

Content, not the extension or MIME type, decides RSS, Atom, RDF, OPML or unsupported XML. Existing XML validation rejects DTD/entities, malformed documents and content over 5 MiB. A local feed needs an absolute Atom self URL, which is verified online before addition.

Website discovery reads only declared RSS/Atom/RDF alternate links in the HTML head, up to eight candidates and three concurrent transports. Obsidian requestUrl does not expose a reliable final response URL. Therefore relative links require a safe explicit absolute base; ambiguous relative links after redirects are not guessed. Direct feed addresses remain supported.

One interaction has a 30-second reading deadline and a slower-response hint after eight seconds. In-flight requests to the same address are shared. Native requestUrl cannot truly abort or stream a response: cancellation invalidates the result, and the underlying request continues to occupy its concurrency slot until it settles. The byte limit is checked after native download, not a promise of pre-download truncation.

Parsed single-feed content and HTTP validators pass directly to the subscription transaction, avoiding the repeated preview/add download. OPML import itself does not fetch all article bodies. Capacity remains 2,000 subscriptions.

## Verification

Automated coverage includes RSS/Atom/RDF, OPML under .xml, HTML candidates, unsupported and unsafe XML, duplicate submissions, cancellation, persistence rollback, undo isolation and IME Enter. Native macOS Obsidian checks cover live Lex XML addition and undo, website discovery, OPML with group preservation, late network responses after editing, and all 2,000 entries remaining selectable with bounded initial rendering.

Native light and dark screenshots verify 40px desktop inputs/buttons, 44px at 390px, no horizontal overflow, and a visible import footer. Narrow desktop windows are not mobile hardware verification. Windows and phones have not been tested.

## Research

- [Feedly RSS URL](https://docs.feedly.com/article/653-how-to-follow-mastodon-activity-feeds): a URL can enter through search.
- [Inoreader](https://www.inoreader.com/blog/2024/11/getting-started-with-inoreader.html): shared name/URL entry and OPML migration.
- [NetNewsWire](https://netnewswire.com/help/ios/6.1/en/adding-feeds.html): feed or website URL with discovery.
- [Feedly OPML](https://docs.feedly.com/article/51-how-to-import-opml-into-feedly): file/drop and preserved categories.
- [RSS autodiscovery specification](https://www.rssboard.org/rss-autodiscovery): declarative alternate links in the HTML head.

Uses the existing parser and native HTTP API. No new service, account, AI detection or scraping dependency.
