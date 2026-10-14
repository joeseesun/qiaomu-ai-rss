# QMReader 管理员正文链接队列 1.0.0

网站管理员右键原文、翻译或中文改写中的网页链接，选择「加入转写队列」。复用网站管理员登录与现有 lab-collection 持久化队列；在正文菜单或管理页「转写队列」查看进度，失败重试，完成后打开中文改写。

处理顺序：抓取网页正文，翻译标题及英文正文，生成中文改写。中文正文跳过无必要的翻译。处理阶段持久化；页面刷新不丢任务；同 URL 去除片段后去重，网络请求超时后再次提交会返回同一任务。音视频逐字稿不在本模块范围。

权限与限制：新网站接口 `/api/admin/collection-jobs` 使用服务端已认证的 `req.user` 管理员角色，写入拒绝跨站 Origin；共享邀请码不授予管理员权限。复用现有 URL、DNS、重定向安全校验，已删除文章不复活。最多同时排队 30 个、全局每日 60 次入队（含管理员重试），每条最多重试 5 次。原插件 API 兼容。

## 安装

在已经部署 lab-collection 的 Reader 上运行：

```sh
python3 server/web-collection/install.py --root /opt/qiaomu-apps/qmreader
systemctl restart qmreader
```

安装器只替换 `lib/lab-collection.js`，增加 `lib/web-collection-process.cjs`、`public/web-collection.js` 和 CSS，增量修改既有挂载和 HTML 脚本引用；不覆盖其他未提交网站改动或数据库。锚点不匹配或 JS 语法失败时停止，不修改目标。支持重复安装；备份在 Reader `.deploy-backups/web-collection-<timestamp>`。回滚恢复该目录的 server.js、index.html、lab-collection.js，重启服务，保留队列数据。

## 验证

```sh
node --test server/admin-link-queue.check.cjs server/web-collection.check.cjs server/lab-collection.check.cjs
python3 -m unittest discover -s server/web-collection -p 'test_*.py'
```

浏览器验证须覆盖嵌套链接的真实右键、浅色/深色/390px 窄屏、队列刷新、打开结果与失败重试。模拟模型结果的 UI 验证不能代替生产 AI 完成记录。
