# CO11-04/06：同一音频的诊断闭环

用户批准按“补证据→定位修复→集中回归/新同源资格/部署/iOS验收”执行。以6f2cabf为基线，保留原36dbb24/2804失败证据。本提交是必要的诊断能力，不宣称安静误识别、语义标点或实际分人质量已经修复。

## 复用与边界

- 复用冻结1.0的 `CoreMlNemotronDiagnosticRecorder`，加入 metadata-only 模式；原调用默认仍保留原音频记录行为。新的在线路径不调用 appendAudio，即便误调用也不保留PCM、不生成WAV。
- iPhone VAD记录原PCM批次序号、捕获样本范围、摘要、16k分析窗、概率、hasSpeech与端点状态。阈值、最短语音、静音时间、连续上传方式不改。
- Sortformer记录同一上传PCM批次摘要、4-slot原始概率、原ActivityDecoder后的spans以及有效模型参数。不改Fastest权重、cache31或1.0复用的活动规则；不登记身份。
- Gateway在原验证成功后记录接受的speaker spans、其对应的文本时间窗与最终标签；ASR记录原始文本摘要、词级偏移/时刻。没有正文、原始录音、凭据或用户身份嵌入进入这些诊断日志。
- 捕获时钟不冒充已上传时钟：VAD的批次sequence/SHA与Gateway接收水位对应，speaker使用已经上传的累积样本。24k重采样分析时钟单独标记，不能直接假设无延迟等同原PCM。
- 手机本地每个原生记录器最多4096个事件，超出明确truncated；文件权限0600。该上限只截断诊断，不停止会话、收费或模型。服务端继续复用显式QA trace开关，日志失败不改变业务结果。

## 候选与取证

`ENABLE_ONLINE_EVIDENCE_TRACE` 默认为false。原构建脚本仅允许在显式profile候选中打开，并把开关、metadata-only和上限写入候选manifest。公开版普通入口、Bundle、沙箱、模型资源和全部local profile保持原路径；不做独立测试App。

先固定源码和构建身份，取得新源静音/朗读组合资格，再在原Beelink隔离QA部署，升级同一public App。用户已确认手机USB/解锁可配合。用原70秒固定音并保留安静尾段，取同一session的手机日志、接受水位、ASR原文/词时刻、speaker关联和唯一结算。不得通过iPhone镜像开麦，不自动关入口或强制结束App。

## 三项判定

1. 安静额外文本：核对该时间窗是否实际被本机VAD判成语音、上传PCM是否一致、云ASR是否在无语音证据时产生正文。无证据覆盖则不声称根因；不按禁词删除真实短答。
2. 标点：比较ASR原始文本/词标点与最终记录；先定位生成阶段，再评估已有纠正策略，不硬写固定测试句答案。
3. 分人：先看原始概率，再看ActivityDecoder输出，再看服务器接受与关联。只有明确某层错误才改该层，不因一个unknown标签放宽全部边界保护。

2026-09-29复核[百炼客户端文档](https://help.aliyun.com/zh/model-studio/fun-asr-client-events)：当前语义断句和heartbeat字段有效；语义断句不以VAD静音时长决定句末。文档另列近/远场VAD和噪音敏感度选项，但本提交未改变这些值，也未引入新模型或上下文上传，待实际样本证据再判断是否相关。

HOST集中回归1912项通过、专用PG环境1项跳过；手机诊断开/关各33项通过；metadata-only原生记录器检查通过。首次Swift测试把throwing文件读取写进precondition自动闭包，及首次手机命令列出不存在的测试文件，均保留失败回执并已修正复跑。目标构建、真实资格、部署、DEVICE分层另取证。
