# 无界AI企业版服务说明

版本：候选模板 1.0
状态：未批准，不构成商用承诺

## 1. 服务范围

无界AI企业版是平台统一托管的多租户 SaaS，由企业 Web 控制台、员工移动端、Web
访客参会页和电话媒体入口组成。首期只提供三条业务主线：

1. 企业会议、实时字幕、翻译、受控屏幕共享和会后材料。
2. AI 客服、租户知识检索、只读或经确认的工具、人工接管和质检。
3. 经国家策略、授权、禁拨和审批后执行的出海外呼营销。

服务不包含通用 OA、完整 CRM、完整工单平台、客户自建服务器安装包或私有模型交付。
CRM、日历、通讯渠道、PSTN 和对象存储均通过受控 Adapter 接入。

## 2. 租户与数据边界

- 企业、成员、角色、业务记录、通讯会话、计量、账本和审计均绑定 `tenantId`。
- 生产数据真值为 PostgreSQL；SQLite/JSON 只用于本地开发和封闭演示。
- 租户路由绑定区域、Cell 和 route epoch；客户端提供的 tenant、role、scope 或 cell
  不能决定权限。
- 会议、客服和营销各自保存业务聚合，但统一引用 `communicationSessionId`。
- 外部副作用使用幂等键、Inbox/Outbox、generation 和 Provider receipt 收敛。

## 3. 角色和管理责任

服务支持 owner、admin、billing、meeting、support、marketing、auditor 等最小权限角色。
企业管理员负责成员授权、国家策略、知识和术语版本、录音/声纹/诊断授权、保存期限及
外部 Provider 绑定。平台负责运行环境、数据库、媒体、模型、升级、监控和备份。

## 4. 能力状态

产品成熟度使用 `designed`、`implemented`、`verified`、`production_ready`；运行时能力
使用 `not_configured`、`checking`、`ready`、`degraded`、`not_ready`。未配置或未通过
readiness 的 Provider 必须明确降级或阻断，不能返回模拟成功。

## 5. 正式发布前提

正式发布必须由候选 manifest 绑定同一 commit 和 image digest，并通过 A0–A3、H1–H3、
安全、隐私、法务和运维审批。任何本地静态测试、mock、单节点 PostgreSQL 或同机恢复
都不能单独证明企业生产就绪。
