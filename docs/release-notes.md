管理员可以从文章列表右键、文章更多菜单或已完成转写右键打开「移动到频道或目录」，搜索任意公共频道或私人订阅分组。公共移动对所有读者生效；私人分组只影响当前知识库。文章 ID、正文、改写和收藏关联保留，刷新与重启后仍保留位置。

转写失败显示具体原因。配套服务器按 DOM 结构拆分超长图文，保留全部文字、链接和图片；识别英文作者署名，继续检查正文完整性。成功的翻译块保存进度，失败重试或服务重启后只补缺失部分，不把不完整文章标成成功。

English: Administrators can organize articles and completed rewrites into any public channel or private subscription group. Public changes affect all readers; private groups are vault-local. Preserve identity, content and reading associations across refreshes and restarts. The companion server update splits oversized structured content without truncation and checkpoints successful translation blocks for bounded retries.

Validation: repository checks, real server move and restore with unchanged content/rewrites, private-group move/read/reload in isolated Obsidian desktop, narrow light/dark dialog checks. Physical mobile devices have not been tested.
