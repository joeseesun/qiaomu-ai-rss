## 中文

- 阅读列表只更新变化的文章行，翻页追加内容；连续保存合并写入，图片下载后立即显示，后台整理本地缓存。
- 当前阅读优先，频道请求受并发限制。取消等待 8 秒就补发请求的行为；连接失败和 408/502/504 最多恢复一次，多个请求共享重试预算。遇到 429/503 遵守冷却与 Retry-After，避免服务繁忙时放大请求。
- 列表使用兼容旧服务的轻量响应，只省去插件不使用的统计等字段；标题、摘要、图片、分页和详情保持完整。自有 API 已部署公开读取的短时共享缓存，认证请求绕过，修改和数据变化使缓存失效。

本机桌面 Obsidian 已验证列表、焦点、阅读、保存和失败恢复。服务器小样本验证了响应体缩小和缓存命中；未进行最大容量压测或手机真机测试。更新后保留设置、收藏、阅读记录和缓存。

## English

- Reuse unchanged article rows and append pages. Coalesce durable saves and display downloaded images before background cache maintenance finishes.
- Prioritize reading and bound channel concurrency. Remove speculative duplicate reads after eight seconds. Retry settled connection failures and HTTP 408/502/504 at most once within a shared retry budget; cool down on 429/503 and honor Retry-After.
- Negotiate lean list responses without removing titles, summaries, images, pagination or article content. The self-hosted API now shares short-lived anonymous responses, bypasses authenticated requests, and invalidates on mutations and data changes.

Verified desktop Obsidian interactions and small production API samples. These checks do not establish maximum server capacity or physical-phone compatibility. Existing settings, favorites, reading history and caches are preserved on upgrade.
