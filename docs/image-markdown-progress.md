# 图片 Markdown 修复

更新时间：2026-10-23（Asia/Shanghai）。基线：origin/main 652bc2d，插件 0.32.0。

目标：Latent Space DeepInfer 文章在改写模式下的 4 张图片真实显示，并兼容已经缓存的正文。

原始证据：公开 entry/rewrite API（条目 760dac152d4912508995aa1ea220f1e5）和 rockfish 当前 reader bundle 一致：4 个图片引用，其中 3 个为 `![[image](URL)` / `![[Image preview](URL)`，alt 内有未闭合方括号；当前 DOM 只有 1 张图片。原文 HTML 有 4 张图片。网络图片下载尚待独立验收。

范围：隔离分支修复阅读器兼容，检查生成端 alt 转义；保留用户数据和缓存，不混入旧工作区改动。待验证回归测试、构建、真实 Obsidian 显示、已安装资产和发布状态。

## 已验证

- 修复前回归测试 4 项中 3 项失败；修复后 310 项 Vitest、31 项服务器检查和 1 项 i18n bundle 检查通过，lint 0 Error（10 项既有 Warning），TypeScript 与生产构建通过。生产依赖审计 0 漏洞。
- Obsidian 1.13.7 隔离库 `/private/tmp/qiaomu-agent-pele-20261018/vault` 加载 0.32.1，用真实 API 正文打开改写：4/4 图片 complete 且 naturalWidth > 0，尺寸分别 1326×1362、680×640、1142×622、1414×560；无残余 `![` 文本、无宿主脚本错误。已查看渲染截图。
- 检查生成端原始图片引用和原文 alt；本例错误存在于生成后正文。采用阅读/导出共用入口兼容，不重写历史文章或清空缓存。未修改服务器。
- 发布资产审计通过，main.js 4,989,953 字节，低于 5 MB 预算。
- 待完成：官方最终候选预扫描、草稿资产/升级验证、公开下载与合并、正式审核与本机 rockfish 更新。Windows 和实体手机未验证。
