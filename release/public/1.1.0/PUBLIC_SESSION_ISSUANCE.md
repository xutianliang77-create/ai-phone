# 公有会话准备、凭证发行与原Gateway绑定（第78批）

本文件描述原API/Gateway内的开发接口，不是新公开端点，也不是部署完成声明。真实同意、供应商预算和模型资格的生产来源尚未全部接通，公网创建和WebSocket入口继续拒绝公有会话。

## 内部两阶段流程

1. 可信服务器协调方分配并复用sessionId，从已认证上下文取得owner；调用`preparePublicRealtimeSession`。函数复用原CreateSession请求校验、配置快照和会话仓库。保存原业务mode、语言、配置hash/revision及请求摘要，返回prepared_not_admitted，不签Token、不预占客户额度、不调用模型。
2. 独立可信生产方提供已经核验的推理同意、供应商预算、模型资格；沿现有recordPublicInferenceEvidence/writePublicInferenceAdmission记录。同步同意不是推理同意，客户端回执ID不能自己授予资格。
3. 调用`issuePublicRealtimeSession`。再次核对owner/部署/语言/配置/终态及已存授权，复用issuePublicRuntimeLease和原客户额度预占，再原子保存发行元数据，最后复用createRealtimeToken签名。
4. 手机响应包含原sessionId、ownerId/deploymentId、processing和captureSampleRate。采样率只来自服务器lease；客户端请求中的captureSampleRate/publicRuntime被拒绝。
5. Gateway在签名验证和独立的当前授权/lease查询之后，才能调用`createConfiguredPublicSessionFromVerifiedClaims`。签名投影必须匹配服务器解析的配置/授权/binding，再进入原ASR/翻译/TTS装配。不从Token内容生成“已核验”的服务器上下文。

这是在原模块中的两阶段处理，不增加产品模式、模型中台或另一套会话存储。当前没有将两阶段函数注册到公网路由，不能直接依靠配置页启动在线模型。

## 一致性与失败语义

- 相同服务器sessionId、owner和规范化请求重试复用同一准备记录；修改语言/mode/配置或跨owner冲突拒绝。serverId由可信协调方管理，不接收客户端任意指定；HTTP请求级幂等标识与多实例生产协调仍需后续接线。
- 新公有准备记录在原同步存储事务中创建，持久化失败回滚内存；原私有创建分支不变。PostgreSQL仍走原仓库fence/事务，真实多实例数据库部署未在本批验证。
- 客户额度与供应商预算独立：供应商预算通过仍可能客户额度不足。沿原hold机制和hold:sessionId幂等键，不改价格；已释放、已结算或过期的hold即使旧接口返回held也不能使用。
- 预占后的不确定失败保留同一lease和有期限的hold，重试不新增会话/预占，不武断释放另一发行过程的额度。没有凭证已提交时不能返回Token；保留的预占按原有效期规则到期失效，不声称已经完成所有生产补偿/恢复场景。
- 首次Token有效期最多5分钟，且不超过授权/预算/资格的最早期限；重复发行保持原时间戳，不续签或重新开会话。当前发行接口只处理created阶段，不作为断线恢复接口。
- 重用已有lease时核对采样率、语言策略hash、期限、上限和标识，不只比较admissionHash。
- Token绑定deployment、leaseId、captureId、languagePolicyKey、采样率和配置revision/hash。会话存储只保存不含秘密的发行元数据，不保存签名Token、模型密钥或签名密钥。
- 当前已有结果同步授权默认仍false；创建请求syncRequested不能直接变成同步许可。同步授权继续由原独立流程办理。
- 目前只接受已实现的固定语言、连续ASR、关闭Speaker专用推理、无未接通ASR词表以及配置Voice的范围；不隐式启用隐藏/白名单能力。

## 仍保持的生产门禁

原`realtimeCreationBlocker`和`admitRealtimeConnection`未放行公有请求；只有publicRuntime字段的Token也不能落入旧私有/mock路径。仅新增内部函数和严格绑定，不把签名正确当成当前资格/授权/预算有效。

后续需要接通：原HTTP受控协调入口和真实同意/预算/资格来源、服务端请求幂等/失败恢复、Gateway当前授权查询与受限凭据通道、租户/部署/签名配置的实际隔离、真实模型与同一候选设备验收。本批模拟测试不替代上述事项。
