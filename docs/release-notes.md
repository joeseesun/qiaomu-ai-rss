## 中文

订阅多时更流畅：列表只绘制当前可见文章，缩略图接近屏幕时才下载；刷新合并更新，中文搜索不打断输入法，新增文章保留当前滚动位置。

启动不再预读整份原文缓存，原文按需从分片缓存读取；已保存的 AI 改写和翻译仍沿用原有存储格式。清理缓存保留文章目录、收藏及已保存内容；升级保留旧缓存备份、阅读状态和设置。

阅读器打开期间，个人订阅按更新频率后台检查，预留当前文章的请求容量；手动刷新复用 HTTP 缓存，关闭阅读器停止排队刷新。

隔离桌面测试覆盖 100/500/2000 个订阅、最多 10 万篇文章，以及缓存迁移和重启恢复。具体速度受设备、数据与网络影响。移动设备实机及生产服务端容量未验证；本次未部署服务端变更。

## English

Large libraries stay responsive with a viewport-sized article list, genuinely lazy thumbnails, coalesced updates, IME-aware search and stable scroll anchors.

Startup no longer eagerly reads the full original-body cache. Original bodies load on demand from local shards; saved AI rewrites and translations retain their existing storage format; cache eviction preserves article metadata and protects favorites and saved content. Upgrades keep a legacy cache backup, reading state and settings.

While a reader is open, personal feeds refresh in the background according to their publishing cadence. Foreground reading retains request capacity, manual checks reuse HTTP validators, and closing the reader stops queued refreshes.

Tested in an isolated desktop vault with 100/500/2000 feeds, up to 100,000 articles, cache migration and restart recovery. Mobile hardware and production server capacity remain unverified. No server deployment is included.
