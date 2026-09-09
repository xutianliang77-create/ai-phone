# 原内部恢复前置查询（第86批）

在既有`/internal/realtime/sessions/:sessionId/admission`中使用`purpose: recovery`。这是只读状态检查，不是新增会话、连接接管或推理许可；默认公有断线续接仍关闭。

## 输入和输出

请求继续使用原部署、账号、会话、grant、lease、capture、语言策略、采样率、配置版本/hash及随机requestId。原内部认证和HTTPS边界保留；客户端不能填写恢复样本水位或计量值。

当前会话必须有已发行记录、有效原授权/配置/lease，状态为paused且运行证据为可信disconnected，仍在原恢复窗内、活动额度未耗尽。返回`status: paused`及recovery中的runtimeSequence、lastAcceptedSample、finalRevision、activeMs、recoveryUntil。有效截止不得越过原lease；等待时间不通过查询计入activeMs，也不会刷新恢复窗口。

所有字段来自同一原会话快照。Gateway使用原API sink的有界传输，每次新nonce、完整匹配，既不缓存也不自动重试。旧握手Token可以作为已核验原身份的查询上下文，但查询不会续签Token，更不会让过期Token重新具备WebSocket握手资格。

## 不能用于哪些动作

- recovery回执不能替代connect或dispatch回执；原authorize方法不接受这个用途，只能通过inspectRecovery读取。
- 配置/凭据端点拒绝recovery；原Gateway材料客户端也在传输前拒绝，不能借只读检查取得模型密钥。
- 回执不是所有权锁。下一步原连接代际接管必须原子复核runtimeSequence、原水位及最新授权；并发/旧回执不能直接恢复音频。
- lastAcceptedSample是已接收水位，不是“已推理完成”的证明。不得据此重放未决音频、清除attempt或重复计费。

本批测试通过不改变现有正常断开的立即结束策略。实际Gateway断开证据写入、同会话接管、跨实例/PostgreSQL和真机恢复仍待完成。没有部署、安装、真实供应商调用或新的模型/账务域。

第87批进展：[原Gateway断开检查点与代际接管](PUBLIC_DISCONNECT_HANDOFF.md)已将可信断开观察接入默认清理，并提供原session map内的受条件约束接管。默认仍立即结束，新WebSocket恢复装配尚未启用；同进程比较不替代API/数据库的分布式所有权确认。
