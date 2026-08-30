# ENT-REL-005 企业发布材料代码候选证据

日期：2026-08-31
状态：`in_progress` / `AC-ENT-0054 not passed`

## 交付范围

- 新增 schema-v1 企业发布 manifest，固定候选 commit/image、七类材料、A0–A3/H1–H3 证据和六方审批。
- 新增根内相对普通文件、2MiB上限、非符号链接、SHA-256、草稿标记和候选身份校验。
- 新增 `check:enterprise-release-materials` CLI。
- `/health` 增加 `enterpriseReleaseMaterialsReadiness`；`/health/release-ready` 强制汇总其 issues。
- 新增服务说明、发布说明、SLA、隐私/数据处理、管理员、运维/事件和发布清单七份候选文档。
- 新增 draft/pending 示例 manifest，示例本身不能成为发布证据。

## 设计不变量

1. 国内移动 App 发布材料 ready 不能抵消企业发布材料 not_ready。
2. 主产品、其他分支、旧候选或其他 image 的验收证据不能继承。
3. A0–A3/H1–H3 缺任一项即失败；H3 缺批准 SLA 与跨故障域实测时不得承诺 RPO/RTO。
4. checker 只验证引用和证据完整性，不生成测试、审批、法律结论或生产 readiness。
5. 健康响应只返回状态、候选身份、检查项和脱敏 issue，不返回材料正文或凭据。

## 本轮执行边界

用户要求测试先略过，因此没有运行 Vitest、API 回归或全 Node 回归。企业 worktree 没有本地 `tsc`；尝试
调用 workspace typecheck 在 `tsc: command not found` 前退出。借用个人工作区编译器进行纯读取检查时，因企业
worktree 未安装 Node 类型和 workspace 依赖产生全仓 module-resolution 错误，不能作为有效 typecheck 证据。
随后只读复用该编译器和个人工作区现有 Node 类型，对本任务五个新增核心模块执行独立 strict TypeScript
检查并通过；该窄检查不替代 API workspace typecheck。
没有执行 npm install/ci，也没有启动 API、数据库、浏览器、Provider 或设备。

## 未满足的正式证据

- 真实候选 image digest 和干净候选 manifest。
- A0–A3、H1–H3 全部通过且独立 reviewer 复核的证据文件。
- 批准的 SLA、隐私/法务文本和产品/工程/安全/隐私/运维/法务审批。
- 自动化、运行时健康、真实 PostgreSQL、跨故障域、Provider、Web/Flutter 和真机结果。

因此 `ENT-REL-005` 只能保持 `in_progress`，不得宣称企业发布材料 ready、A4 或 production ready。
