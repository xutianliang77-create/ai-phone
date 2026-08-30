# 无界AI企业版管理员手册

状态：未批准的候选手册

## 1. 开通和成员

1. owner 创建企业并选择 home region；等待 provisioning job 完成。
2. 通过企业设置添加已注册账号，分配最小角色并复核 active membership。
3. 分离日常 admin、billing、meeting、support、marketing 和 auditor 权限。
4. 定期复核离职、暂停、MFA、异常登录和审计记录。

请求体中的 tenantId、role 或 resource ID 不是权限依据；页面隐藏按钮也不是安全边界，服务端
membership、RBAC、route document 和 forced RLS 才是最终守卫。

## 2. 服务和内容配置

- 发布知识、术语包和话术前完成审核；会话只引用已发布且在有效期内的不可变版本。
- 配置区域、Provider、套餐、entitlement、预算和告警；`not_ready` 时不得强行开始副作用。
- 分别配置端侧/云端 ASR、翻译、TTS、声纹、录音和诊断授权及保存期限。
- 不向客户端、浏览器或普通成员提供 Provider 密钥、数据库地址或平台内部控制密钥。

## 3. 会议、客服和营销

- 会议：配置主持人、成员/访客、语言、保存期限和共享策略；访客 token 只短期驻留内存。
- 客服：配置队列、SLA、知识范围、工具 revision 和接管规则；高风险动作只转人工。
- 营销：依次完成 Lead、授权证据、禁拨、国家策略、活动校验和审批，再允许 Scheduler/PSTN。

## 4. 账务、审计和数据

预算按 tenant、类别、单位和 UTC 周期配置，不同单位不能相加。用量和账本只追加，纠错通过
受控 adjustment。审计导出应填写目的、范围、保存期限并保护下载；删除前核对数据库、对象和
Provider receipt，不能把“已请求”当作“已删除”。

## 5. 故障和升级

遇到 degraded/not_ready 先查看 capability、trace ID、租户灰度和 circuit 状态。管理员只能查看
本租户脱敏状态，不能执行平台 failover、restore、fence 或 half-open probe。P0/P1 事件通过正式
支持渠道升级，不在客户页面粘贴密钥、原始音频、正文或完整 Provider 响应。
