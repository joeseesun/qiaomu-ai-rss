## 中文

- 文章列表先显示已返回的内容，不再等待频道目录、删除核查和补充播客请求。多频道读取逐个更新，失败源保留缓存。
- 原文先于改写和翻译显示；辅助请求失败不遮住正文，迟到结果不覆盖新选择，改写返回后恢复默认阅读版本，尊重手动选择。视频文章也遵循默认版本设置。
- 读者提交的阅读状态与平台筛选分行排列，窄侧栏自动换行。重启后恢复读者提交频道。
- 保留稍后读、分批列表渲染与正文缓存拆分，升级不改变现有订阅、收藏和阅读记录。
- 同步 Atom 命名空间解析及移动端文字选择、订阅菜单修复。

已验证桌面 Obsidian 的慢请求、乱序响应、缓存恢复及 220/300/520px 侧栏；未进行手机真机测试。网络本身较慢时仍需等待正文请求，但可继续阅读已有缓存。

## English

- Show returned articles without waiting for the channel catalog, deletion checks or supplementary podcast requests. Update channels independently and retain cached pages for failed sources.
- Display the original before optional rewrite and translation requests finish. Ignore outdated results and restore the preferred version when it arrives, respecting manual changes. Video articles also follow the default version setting.
- Separate reading and platform filters, wrap them within narrow sidebars, and restore the reader-submitted channel after restart.
- Preserve Read later, windowed lists and split content storage without changing subscriptions, favorites or reading history.
- Include Atom namespace parsing and mobile text-selection/subscription-menu fixes.

Verified in desktop Obsidian with stalled requests, out-of-order responses, cached restoration and 220/300/520px sidebars. Physical mobile devices were not tested. Slow networks can still delay the primary request; cached content remains usable.
