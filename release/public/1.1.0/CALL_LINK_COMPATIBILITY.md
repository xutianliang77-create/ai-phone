# CO11-11：原 Call Link 白名单兼容交付说明

更新：2026-09-26。当前状态：`SOURCE_FIXES_HOST_PASS / REAL_DUPLEX_PENDING / NOT_DEPLOYED`。后置集中API与Worker回归已覆盖本批26个新增病例及原受影响分支；Worker全量58文件251项通过，API全量1264项通过/5个实库条件用例跳过。新同源镜像已构建，但没有模型调用、建房、部署或设备操作，不能将本文件解释为双端整项验收完成。下方静态批次说明保留为历史。

## 范围与复用

原方案要求复用最终1.0白名单控制面和Worker，在独立1.1兼容部署运行；不是建设新的全公共Call Link Worker。冻结基线为`898ee517e7aac00b03bc79ff2d0597dd00fdbf56`，当前改动基于e951519工作树。

`services/translation-worker/src/worker/`相对冻结基线仍无差异：双端轨道、turn/revision/generation、字幕、打断、播放队列、尾句与关闭逻辑均复用原实现。本批只修1.1入口/返回绑定及API结束清理，不修改ASR模型、翻译prompt、TTS协议或客户计价。私有1.0源码、部署、数据和沙箱不动。

兼容部署是服务器实现边界，不是手机新增第三种模式。Web Guest、SIP/PSTN、Air780等仍保留原隐藏/延期等级，`room`兼容许可不扩展到这些入口。

## 模型对接边界

| 环节 | 现有实现与配置来源 | 禁止误用 |
| --- | --- | --- |
| ASR | 原`HttpAsrProvider`／`PersistentAsrStream`合同；由独立兼容实例的ASR endpoint/key配置指定 | 不能把公有同传Qwen Realtime WSS直接填成旧ASR接口；不借旧私有实例或丸子凭据 |
| MT | 原`OpenAiCompatibleTranslationProvider`，baseUrl/model/key及流式参数随该实例配置 | 腾讯TMT等原生接口不是Chat Completions；不将公有配置页保存成功当Worker已适配 |
| 旧TTS | 未开启公共TTS时保留原HTTP TTS合同 | 不作为缺公共TTS资格/材料时的隐式回退 |
| 腾讯公共TTS | 开启明确兼容选项后，按dispatch generation取得原`CallLinkTencentTtsProvider`材料；复用共享`streamTencentTtsPcm` | 不从全局环境取腾讯供应商密钥、不从普通手机token取材料、不复用实时Gateway凭据通道 |

Voice、Volume、16k/24k输出跟随绑定profile，Worker每次取得的材料必须与原profile完全一致；取消、终结和未知费用沿既有合同。腾讯兼容attempt中的派生字符数不是供应商发票，API返回`costStatus=unknown`，不能用其直接扣客户余额。该旧兼容TTS记录仍有1024条保护上限，不能把CO11-09同传的10000条分页结果当作此路径的容量证明；本批未擅自扩容或改存储模型。

## 启动声明与数据隔离

独立兼容实例必须同时匹配以下声明；仅设置某一个标记不构成许可：

| 声明 | 要求 |
| --- | --- |
| `API_RESULT_SYNC_DEPLOYMENT_ID` | 独立1.1部署身份，精确合法值，不自动trim修复 |
| `CALL_LINK_1_0_COMPATIBILITY_ENABLED` | 明确为`true` |
| `CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID` | 与部署身份精确相等 |
| `CALL_LINK_1_0_COMPATIBILITY_PROFILE` | `call_link_only` |
| `CALL_PROVIDER_POLICY` | `call_link_only` |
| `CALL_LINK_DEPLOYMENT_TEST_MODE` | `true`时仅可空闲注册，不得进房/启动推理，即使缺部署ID也不能回到私有路径 |
| `CALL_LINK_PUBLIC_TTS_ENABLED` | 开启时另需绑定资格、profile和独立Worker材料访问权限，缺项拒绝 |

API、Worker、LiveKit、数据目录与内部密钥须属于同一隔离兼容部署。供应商密钥、LiveKit密钥、签名票据不写入交付文档或日志。过去的回环idle QA只证明进程注册与失败关闭，不提供正式媒体端口、域名、模型或双端通话资格。

## 原入口逐项映射

| 原验收条目 | 当前源码落点 | 本批处理 |
| --- | --- | --- |
| API建房/加入 | `call-room-entry.routes.ts`、`call-link-model-runtime-policy.ts` | smoke与不完整兼容/TTS声明先拒绝，不误走legacy_private |
| SIP/Air边界 | `call-link-sip.routes.ts`、`call-link-sip-inbound.routes.ts`、`call-link-air780.routes.ts` | 沿原entryKind策略，不开放隐藏能力 |
| 恢复调度/内部令牌 | `call-link-worker-supervisor.ts`、`call-link-internal.routes.ts`、`worker-dispatch-runtime.routes.ts` | 复用原API门禁及dispatch票据/代际核验 |
| Worker直接进程 | `main.ts`、`call-worker-deployment-policy.ts` | 与API精确部署身份一致；不完整声明不能回私有默认 |
| Agent实际入房 | `translation-agent-definition.ts` | 将部署检查放在`ctx.connect()`和材料请求之前；不阻止无作业的idle注册 |
| 快照绑定 | `worker-dispatch-runtime-client.ts` | 返回前核对callId/sessionId/roomName/generation/participantIdentity |
| 双端媒体/语言 | `livekit-input-track-binding.ts`、`call-tts-playback-routing.ts`及原Worker目录 | 复用角色、MICROPHONE轨道与反向目标，不重写原媒体栈 |
| 结束/唯一计量 | `call-links.routes.ts`、原`completeSessionWithUsage`与supervisor.stop | 结束重试继续调用幂等stop；先尝试stop再做leg/outbox通知，不再次结算 |

本批确认并修正的结束控制流：旧代码先提交ended，再调用stop；若stop失败，重试因`wasEnded`而不再停止Worker。修正后每个经过账号/会话绑定检查的结束重试都会尝试原幂等stop，原账本与session事务仍负责唯一结算。stop被调用不等于外部RTC/供应商已确认停止，实际停止回执仍须后续验收。

## 核验与未完成项

- API和Worker生产源码`tsc --noEmit`通过。另把本批相关7个回归文件纳入静态类型检查；发现的新测试类型推断错误已修正。这些都是编译期检查，不执行用例。
- 新增26个参数化/普通用例：不完整部署、smoke、精确身份、RTC前拒绝、快照错绑、停止失败重试及通知失败顺序；另更新原重复结束断言。按用户要求**全部未运行**，旧HOST数字不能覆盖本批修改。
- 用户随后授权本地保护提交；提交范围仅为本批5个运行时文件、7个回归文件与本说明。类型检查通过不等于回归通过，本地提交不等于push、部署或发版。
- 本轮没有改运行中服务、资格、模型配置、数据库、手机或私有1.0；没有构建新发行镜像/包、push或部署。原用户WIP及前一批通用收尾文档不纳入此提交。
- CO11-11的源码/合同门禁尚缺本批回归通过；部署、真实模型和双端轨道/取消/结束/计量分别留在原CO11-13/14/16集中门禁，不倒灌成新增的源码完成条件。源码/合同收口也不代表产品已具备真实通话验收。

恢复验证时应沿原测试文件和同源候选门禁，不新建平行测试平台；若未通过，则在本批边界内修复。没有明确恢复测试指令前，不启动任何测试或通话。
