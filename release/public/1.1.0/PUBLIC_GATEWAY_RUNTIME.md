# 会话级Gateway配置、凭据与受控WebSocket（第80批）

沿原API、ProviderRouter、RealtimeTtsOutputQueue、SessionEventSink、WebSocket控制/分发/结束链改造。未新增App、业务Provider或会话存储。以下为开发接口和本机合成验证范围，默认生产启动和发布就绪门禁仍关闭。

## API的两类材料

- configuration：原内部鉴权、安全传输、当前admission查询通过后，只返回该会话已发行的配置快照和授权，不含模型密钥。Gateway重算配置身份hash并与签名Token、revision、执行计划及授权精确比对。
- credentials：除原内部鉴权之外，还要求启动时明确安装publicGatewayCredentialAccess以及独立的x-wujie-gateway-credential。这个认证值必须与内部API及手机Token签名密钥不同，且不能由页面/请求启用。只返回当前会话已获准组件所需的凭据；connect阶段只允许ASR，翻译/TTS在有效dispatch阶段解析。

两条路径均检查owner/部署/grant/lease/capture/语言策略/采样率/配置/有效期，no-store；没有API响应或错误日志包含无关组件、私有凭据或原始会话内容。凭据端点默认503。新的服务端认证头、SecretId/SecretKey已加入原日志脱敏规则。

Google服务账号和显式ADC继续只在API解析，原始JSON不发到Gateway，只返回短期访问令牌及到期/配额项目。复用原resolver的缓存及并发取消机制，按session/lease/config/component隔离，至多保留256个resolver；轮换/撤销/过期会重新校验。其他供应商API Key或腾讯SecretId/SecretKey仅通过受限TLS通道进入Gateway内存和原模型传输，不下发手机、不写历史或磁盘。

## 原WebSocket接线

只有启动代码明确提供publicRuntime依赖，且实例是公有部署时，才走新分支。先验签及当前授权，再读取精确配置，装配原ASR/MT/TTS，核对模型握手和连接后的当前授权，最后接入原session map及每会话确认型sink。私有连接继续走原全局Provider路径；新公有分支不会调用它作为fallback。

同一Gateway进程中的重复/并发连接在第二次模型连接前拒绝。启动取消和断开有界清理；未获配置/凭据或绑定不一致不记录已开始活动。单个会话从API收到started确认后才对客户端报告开始，后续音频水位、模型attempt、字幕/历史和唯一结算沿原链处理。

朗读关闭时使用原队列的明确禁用输出，不实例化私有合成器；朗读开启时只使用配置绑定的公共声音。原暂停/恢复与输出取消保留，不接收client.text.segment绕过本次连续公共ASR合同。

## 断开与未决状态

本批公有连接不使用旧私有重连宽限。正常意外断开会尝试有界结束/确认/结算并清理Gateway实例；已确认正常结束不会再结算一次。授权撤销或确认失败时，停止后续处理并保留API未确认状态，不用零费用或成功ended代替对账。

当前**公有断线续接尚未实现**，不能将此安全结束策略签收为原计划的完整恢复功能。多Gateway原子独占、PostgreSQL请求占用、跨实例恢复、未决调用/预占和已删除活动会话的完整处置仍是后续门禁。不得直接开启负载均衡多实例或宣称长网断开无损恢复。

## 验证与默认状态

本机真实loopback WebSocket＋模拟供应商已覆盖Qwen ASR/翻译/公共音频输出、OpenAI ASR/翻译、暂停恢复、原译文保存和唯一结算；暂停2秒不计入活动，两条正常旅程各结算2秒。普通意外断开样例结算1秒，不计重连等待。音频为合成PCM，不是实际供应商听感或iPhone验收。

默认buildApp()/startWebSocketServer()不安装这些生产来源/通道；全局release-ready仍未通过。启用需要真实同意/预算/模型资格来源、独立安全凭据和批准的实例配置，不能只填模型配置页或移除保护分支。当前未部署、未安装、未调用真实模型。
