# Discovery catalog — 0.4.0

The Explore subscriptions view bundles 11 featured feeds and 1,342 Chinese independent blogs. Catalog search, category/theme filtering, and pagination are local. Selecting a source fetches and validates it through the existing subscription service before storing it, then stages that source as the reader's active channel. Blogs are rendered in batches of 60; discovery never subscribes to the entire directory automatically. Existing limits of 100 personal subscriptions and 50 cached articles per feed apply. Qiaomu Blog is already a built-in service channel and is intentionally not offered as a duplicate personal subscription.

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

All 11 featured endpoints returned parseable RSS/Atom with articles on 2026-09-07. This is a point-in-time check, not a future availability promise.

| Source | Feed | Observed items |
| --- | --- | ---: |
| Simon Willison | https://simonwillison.net/atom/everything/ | 30 |
| 少数派 | https://sspai.com/feed | 10 |
| 爱范儿 | https://www.ifanr.com/feed | 20 |
| 极客公园 | https://www.geekpark.net/rss | 30 |
| IT之家 | https://www.ithome.com/rss/ | 60 |
| Hacker News (hnrss) | https://hnrss.org/frontpage | 20 |
| The Verge | https://www.theverge.com/rss/index.xml | 10 |
| Quanta Magazine | https://www.quantamagazine.org/feed/ | 5 |
| NASA | https://www.nasa.gov/feed/ | 10 |
| 36氪快讯 (RSSHub) | https://rsshub.rssforever.com/36kr/newsflashes | 20 |
| GitHub trending (RSSHub) | https://rsshub.rssforever.com/github/trending/daily/any | 18 |

RSSHub route definitions were checked against the upstream implementation: [36kr/index.ts](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/36kr/index.ts), [github/trending.tsx](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/github/trending.tsx). The latter needs GitHub credentials configured by the RSSHub instance operator, not in the Obsidian plugin.

The official public `rsshub.app` returned 403 during testing. The default third-party instance is `https://rsshub.rssforever.com`, shown in the view and configurable to another HTTPS origin. No automatic failover is performed. Changing instances affects future additions; existing subscriptions retain their exact URLs and cached data. Direct feeds are unaffected. RSSHub subscriptions send requests to the selected instance, which fetches upstream content. Operators control route configuration and availability. Zhihu hot, Bilibili ranking, and the RSSHub IT之家 route returned 503 and are not included in the featured catalog.
