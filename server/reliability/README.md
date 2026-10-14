# RSS 抓取恢复 1.1.0

修复活着但不再前进的刷新进程：2026-10-13 开始的任务停在 73/74，阻止之后的刷新。此前 Vultr 只负责公共内容的只读快照，未运行抓取任务。

此包对现有 QMReader 做受控补丁，不覆盖整个网站仓库，不打包生产 `.env`、数据库、账号或密钥。Obsidian 插件仍为 0.28.5；本包独立发布为 `rss-recovery-1.1.0`。

## 行为

- 单源抓取在独立进程运行，60 秒到期直接回收，包含不会响应 AbortSignal 的网络库。失败后通过受限 SSH 请求备用机；远程请求最多 95 秒。
- 刷新进度连续 3 分钟没有变化或总时长超过 45 分钟时回收工作进程。重复发送相同进度不算恢复。后续队列和已有 freshness sweep 继续调度。
- 备用机独立定时抓取已启用的公开源，结果保存在独立数据库；主机停机时也能继续采集。主机恢复后通过逐源接管导入结果。它不自动成为账号和生产数据库的写主机。
- 导入校验来源、时效、条数和大小，保留主库删除记录，忽略账号、权限、AI 资产等远程字段。旧快照仍受原 SafetyGate 和删除票据控制。
- 网页请求总超时 12 秒，包含响应正文读取；GET 最多重试一次，写请求不重放。文章列表不等待频道与账户加载。
- `/api/health` 检查抓取时间、卡住的任务和过期来源；`qiaomu-rss-health.timer` 每两分钟独立检查，异常记录 journal，严重业务故障重启 Reader，重启至少间隔 30 分钟。端点失联或响应无效需连续两次确认，避免部署启动窗口引发重复重启。Codex 本任务另配置每 15 分钟的外部故障/恢复通知，正常时安静。

## 转写边界

抓取公开 RSS、单集和现成文稿不需要 AI 密钥。生成新的音频转写需要服务凭据；目前主机通过已有 Get笔记账号运行 `qmreader-getnote.timer`，AI 改写也仍在主机。此包没有复制这些凭据，也没有实现独立的备用 ASR。Podscribe 来源依赖现有文稿 API，该 API 的整体主机故障不由本包接管。

## 部署

需要 Node 22.22+（运行时使用 `node:sqlite`）和 Python 3。保留现有 Reader、DR 同步和 SafetyGate 配置。

1. 将本目录安装到主机 `/opt/qiaomu-apps/qiaomu-rss-reliability`，运行：

   ```sh
   python3 /opt/qiaomu-apps/qiaomu-rss-reliability/install.py --root /opt/qiaomu-apps/qmreader
   ```

   安装前校验所有补丁锚点与 JS 语法，原代码备份到 Reader 的 `.deploy-backups/rss-recovery-*`。重复安装不重复插入代码。安装器需要从外部目录运行；不覆盖 Reader 原有数据和配置。

2. 在备用机建立 `rss-fetch` 系统账号和 `/var/lib/qiaomu-rss-fetch`，准备 Reader **代码和依赖**至 `/opt/qiaomu-apps/qiaomu-rss-fetch/runtime`，不复制主库或 `.env`。Node 使用 `/opt/qiaomu-apps/qiaomu-rss-fetch/bin/node`，本目录放入其 `reliability` 子目录。

3. 在主机运行 `export-catalog.cjs`，将输出通过 SSH 安全复制到备用机 `/var/lib/qiaomu-rss-fetch/catalog.json`，设为 `rss-fetch` 所有、0600。目录是公开源配置，不含账号。新增、删除或切换来源后重新导出并原子替换；代理每分钟重读目录。

4. 安装备机 `qiaomu-rss-fetch-agent.service`。它只监听 0600 Unix socket，限制内存 512 MiB、CPU 35%，失败自动重启。为主机建立专用 SSH key，在备用账号 `authorized_keys` 使用：

   ```text
   restrict,command="/opt/qiaomu-apps/qiaomu-rss-fetch/bin/node /opt/qiaomu-apps/qiaomu-rss-fetch/reliability/agent-command.cjs" <PUBLIC_KEY>
   ```

   专用身份只有公开目录中来源的抓取/状态 RPC，不提供 shell、转发或 root 登录。

5. 主机 `qmreader.service` drop-in 配置：

   ```ini
   [Service]
   Environment=RSS_APP_DIR=/opt/qiaomu-apps/qmreader
   Environment=RSS_SOURCE_TIMEOUT_MS=60000
   Environment=RSS_FETCH_SSH_TARGET=rss-fetch@207.148.115.69
   Environment=RSS_FETCH_SSH_KEY=/etc/qiaomu-rss-fetch/id_ed25519
   Environment=RSS_FETCH_KNOWN_HOSTS=/etc/rss-dr/known_hosts
   Environment=FETCH_SOURCE_CONCURRENCY=4
   ```

   私钥设 0600，沿用已核验的主机指纹；严格校验不能关闭。安装主机 health service/timer，daemon-reload 后重启 Reader，启用两个 timer/service。后续网站部署需要重新应用本安装器，避免覆盖补丁。

## 验证和回滚

```sh
node --test server/reliability/reliability.check.cjs
python3 -m compileall -q server/reliability
curl --max-time 10 http://127.0.0.1:3088/api/health
# 在主机设置上述 RSS_FETCH_* 环境后执行；仅写临时测试数据库：
node /opt/qiaomu-apps/qiaomu-rss-reliability/drill.cjs
```

真实接管演练将本地抓取超时降为 1 毫秒，验证受限 SSH、备用结果导入、删除不复活；不关闭生产主机。回滚时恢复此次部署备份的五个 Reader 文件，移除 `90-reliability.conf` 并重启 Reader；保留生产数据库和原 DR 配置。可停用新 agent 与 health timer，不影响原只读快照。

本次验证记录见 [verification.md](verification.md)。
