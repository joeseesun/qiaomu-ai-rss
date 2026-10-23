## 中文

- 修复部分 AI 改写图片显示为 `![image` 的问题，兼容已有缓存中的图片括号错误，重新打开文章即可生效。
- 保留正常图片、代码示例、链接和关闭远程图片的行为。未变更文章原文、改写正文或用户数据。
- 已检查 Latent Space DeepInfer 文章。验证记录见 docs/image-markdown-progress.md；实体手机与 Windows 未实机验证。

## English

- Recover images displayed as literal Markdown in AI rewrites, including malformed image references already stored in the cache. Reopen the article after updating.
- Preserve valid images, code examples, links and the remote-image preference. Article content and user data are unchanged.
- Checked the Latent Space DeepInfer article. See docs/image-markdown-progress.md for verification; physical phones and Windows remain untested.
