# Discovery catalog — 0.5.0

The Explore subscriptions view separates three different jobs: 9 editorially selected direct feeds, 1,342 searchable Chinese independent blogs, and 2 RSSHub routes. The featured list only includes identifiable authors or long-running independent publications with original work, recent activity, direct RSS/Atom endpoints, and a distinct editorial voice. It is intentionally short. Qiaomu Blog is already a built-in service channel and is not offered as a duplicate personal subscription.

Catalog search, category/theme filtering, and pagination are local. Selecting a source fetches and validates it through the existing subscription service before storing it, then stages that source as the reader's active channel. Blogs are rendered in batches of 60; discovery never subscribes to the entire directory automatically. Existing limits of 100 personal subscriptions and 50 cached articles per feed apply.

## Chinese independent blogs

Source: [timqian/chinese-independent-blogs](https://github.com/timqian/chinese-independent-blogs), MIT, Copyright (c) 2019 Tim Qian. Snapshot commit: [`4fbded82114fc10f16770d53f287e3af951678cd`](https://github.com/timqian/chinese-independent-blogs/tree/4fbded82114fc10f16770d53f287e3af951678cd). Imported from `blogs-original.csv` on 2026-09-07.

The snapshot preserves introductions as display names, home pages, feed URLs and topic tags. 139 rows without usable HTTP(S) feed/home-page URLs or with duplicate feed URLs are omitted. The directory's order is retained; inclusion does not certify current availability. Some URLs use HTTP. No blog content or images are fetched merely to display a card. A real Reorx feed subscription was checked in Obsidian; DIYGod's listed feed returned 404, which the card reports without adding it. The full 1,342-entry catalog was not individually live-tested.

The source and MIT attribution appear in the UI. The original license is retained in `vendor/chinese-independent-blogs/LICENSE`, third-party notices, and the distributed `main.js` banner.

Maintainers can update the snapshot deliberately, review the diff, run checks, and publish a normal plugin release:

```sh
python3 scripts/update-blog-catalog.py --revision <full-reviewed-upstream-commit-sha>
npm run check
```

This script is a development tool; the plugin does not fetch remote catalog code or update itself.

## Featured feeds and live probes

The remaining 9 direct featured endpoints returned parseable RSS/Atom with articles on 2026-09-07. This is a point-in-time check, not a future availability promise.

| Source | Feed | Observed items |
| --- | --- | ---: |
| 潮流周刊 · Tw93 | https://weekly.tw93.fun/rss.xml | 12 |
| 阮一峰的网络日志 | https://www.ruanyifeng.com/blog/atom.xml | 3 |
| 云风的 BLOG | https://blog.codingnow.com/atom.xml | 15 |
| 槽边往事 · 和菜头 | https://www.hecaitou.com/feeds/posts/default?alt=rss | 25 |
| 张鑫旭的技术作品 | https://www.zhangxinxu.com/wordpress/feed/ | 5 |
| 小众软件 | https://www.appinn.com/feed/ | 10 |
| 月光博客 | https://www.williamlong.info/rss.xml | 10 |
| Reorx’s Forge | https://reorx.com/feed.xml | 50 |
| pseudoyu | https://www.pseudoyu.com/zh/index.xml | 50 |

The user supplied the desired editorial direction. Their duplicated `hecaitou.com` link was assigned only to 和菜头; 阮一峰 uses the direct Atom endpoint documented on his own site. RSSHub-derived items are not counted as featured feeds.

## RSSHub routes

| Source | Route |
| --- | --- |
| 36氪快讯 | `/36kr/newsflashes` |
| GitHub trending | `/github/trending/daily/any` |

RSSHub route definitions were checked against the upstream implementation: [36kr/index.ts](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/36kr/index.ts), [github/trending.tsx](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/github/trending.tsx). The latter needs GitHub credentials configured by the RSSHub instance operator, not in the Obsidian plugin.

The official public `rsshub.app` returned 403 during testing. The default third-party instance is `https://rsshub.rssforever.com`, shown in the view and configurable to another HTTPS origin. No automatic failover is performed. Changing instances affects future additions; existing subscriptions retain their exact URLs and cached data. Direct feeds are unaffected. RSSHub subscriptions send requests to the selected instance, which fetches upstream content. Operators control route configuration and availability. Zhihu hot, Bilibili ranking, and the RSSHub IT之家 route returned 503 and are not included in the featured catalog.

In 0.9.0 Baoyu was removed from featured feeds because its RSS does not provide full articles. Existing user subscriptions are preserved.
