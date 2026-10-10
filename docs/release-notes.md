## 中文

- 频道和文章读取遇到连接中断、502/503/504 等暂时性错误时自动重试一次；请求长时间无响应时也会尝试一次恢复，总等待上限仍为 20 秒。首次请求迟到仍可恢复页面，相同请求继续共享，避免重复点击放大重试。
- 有原文缓存时立即显示，改写返回后再切换；保留用户手动选择的阅读版本。加载失败可在正文旁直接重试。
- 频道目录失败时保留旧频道和文章，重试只更新目录；本地更新失败单独提示，不再误报为频道加载失败。增加仅在本机内存保存的有限请求诊断，不记录正文、查询参数或凭据。

已在桌面 Obsidian 中验证 12 项交互，包括超时恢复、503 恢复、断网后重试、旧响应隔离、缓存阅读和本地保存失败。本机真实链路仍可能超过 20 秒；自动重试不能保证持续网络故障时加载成功。未进行手机真机测试。

## English

- Retry transient connection failures and HTTP 502/503/504 once. A stalled read gets one recovery request while retaining a 20-second overall deadline. The original response can still succeed; concurrent callers share the entire recovery operation.
- Show a cached original immediately while the preferred rewrite refreshes. Preserve manual reading-version choices and offer an inline retry after failure.
- Preserve existing channels and articles when catalog refresh fails. Retry only the failed catalog or local update, and distinguish local update errors from fetch failures. Keep bounded diagnostics in local memory without response bodies, query values, or credentials.

Verified 12 interaction checks in desktop Obsidian, including recovery, offline retry, stale-response isolation, cached reading and local save failures. Real network requests can still exceed 20 seconds; retries cannot guarantee recovery during a sustained outage. Physical phones were not tested.
