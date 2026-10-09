## 中文

- 多个阅读窗和重复打开共享正在进行的相同请求，减少重复正文、改写、翻译与频道请求。完成后的正文请求仍读最新数据，失败或超时后可以重新尝试。
- 频道目录在本机复用 60 秒；点击刷新会重新获取。切换服务地址时不会复用原服务的请求或目录。
- 多频道同时返回时，合并同一帧的列表渲染，减少重复创建列表。

已验证桌面 Obsidian：同一客户端模拟 100 次并发打开同篇文章，网络请求由 300 次降至 3 次；目录连续读取 20 次复用一次请求。这些是重复操作测试，不代表服务器可承载的用户数量。保留默认乔木改写、手动版本选择和删除校验。未进行手机真机测试。

## English

- Share in-flight identical reads across reader views and repeated opens. Completed article reads remain fresh, and failed or timed-out requests remain retryable.
- Reuse the source catalog locally for 60 seconds; explicit refresh bypasses it. Changing the service origin isolates requests and cached catalogs.
- Coalesce simultaneous channel updates into one list render per animation frame.

Verified in desktop Obsidian: 100 concurrent simulated opens of the same article in one client reduce network requests from 300 to 3; 20 sequential catalog reads reuse one request. These are duplicate-operation tests, not server capacity claims. Preferred rewrites, manual version choices and deletion checks remain supported. No physical-phone verification.
