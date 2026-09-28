# Qwen Audio 3.1 Streaming 主候选：源码接线，部署与设备资格另验

2026-09-29 续作：下文保留 36dbb24 接线时的历史证据。该候选随后已部署并接受 2804 实体静音轮，质量未通过；最新源码修复、1.0 复用证明与未关闭项见 [CONFIRMED_GAPS_20260929.md](CONFIRMED_GAPS_20260929.md)。本轮未改现役候选。新的 LID 策略把中文脚本候选归并，并对术语保护后的观察副本绑定 hash；仍不把文本识别当声学语言证据。

2026-09-28用户选择`qwen-audio-3.1-asr-flash-streaming`，随后确认采用iPhone文本语种识别并回传服务器核验。原App、Provider、会话/历史/账本路径内完成增量接线；本批没有部署、安装、修改远端配置或新的真实模型调用，不能据此声称已切换或DEVICE通过。

## 实际供应商证据

一次28秒固定多语言PCM，经同一已授权百炼工作空间的`/api-ws/v1/inference`，以`run-task`/二进制PCM/`finish-task`完成，最长网络运行45秒，无自动重试。使用普通权重4的三个技术热词、语义断句及静音心跳；未上传手机录音或客户历史，未调用MT/TTS。

实际35个事件包括4段最终结果（英、日、法、中）、字级时间戳，以及正常task-finished。结尾用量为input_tokens686/output_tokens50/total_tokens736、duration25；音频实际上传28秒，不把这两个时长混为一谈，也不将Token折算成客户余额。本次中间/最终usage为累计快照且有重复嵌套，不能累加。没有供应商账单或reported-model回读，记录的是请求型号及实际返回字段，不冒充结算金额证明。

本次所有事件没有逐句language字段。这与[官方服务端事件](https://help.aliyun.com/zh/model-studio/fun-asr-server-events)字段表的缺口一致；能自动转写不等于能够直接沿用当前Qwen3的供应商语种证据。静音心跳、语义断句、即时热词及任务事件参见[客户端协议](https://help.aliyun.com/zh/model-studio/fun-asr-client-events)；endpoint参见[接入指南](https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api)。

## 当前接线与范围

原ASR目录增加任务式transport，注册`qwen_audio_streaming`，仍由原`HttpAsrProvider`和业务Provider接入MT/TTS。每个产品会话一个供应商task/ASR attempt，每段PCM前持久确认增长水位；phone VAD边界只取出已完成句，不结束云task。只有正常产品结束才发送finish-task；连接失败不自动重开。usage按累计快照，不累加嵌套副本；客户余额仍沿原计量和唯一结算。

手机复用NaturalLanguage文本识别，每句使用独立recognizer，无语言hint/constraint、无跨会话上下文；不打开麦克风、不下载模型、不调用额外云API。`text.language.request/result`绑定socket/session、随机requestId、segment、revision、原文UTF-8 SHA-256。回传在原控制队列之外消费，避免End等待尾句时死锁；手机点End后仍可处理尾句，session.ended/断线/代际改变后丢弃。旧App/Android不得冒充iOS能力，自动模式在创建前给出明确能力提示，Gateway在凭据读取前再次核对协议。

服务器校验未约束的前3项语言概率、主语言、置信度和授权来源范围；不把文本证据冒充声学结果或ASR置信度。v1保守要求最高概率≥0.85、与次高差≥0.2、至少4字母字符；以拉丁字母为主的文本还需至少8字母和2个词。手机1500ms/服务器2000ms超时均保留不确定。未知原文按`language=auto`保留并产生片段级翻译失败，继续会话；绝不默认猜中文。纯标点按原空revision撤回，不询问语种、不发送MT/TTS。

配置页独立暴露语义断句和静音心跳，默认true，纳入静音/朗读双快照；新协议地址须`/api-ws/v1/inference`。供应商/协议切换清除不兼容字段及凭据；旧Qwen仍不发送未支持的corpus。只有新Qwen将已签名、账号隔离、按实际方向筛选的术语投递为即时vocabulary，普通权重4，上限120。未加跨会话上下文上传或continue-task，不宣称热词实际准确率通过。

## 证据与剩余门禁

真实35事件fixture→新transport→原Provider→MT的HOST测试覆盖英/日/法/中及原自动反向/第三语言路由。原Gateway真实loopback WebSocket→原API内存存储证明：End期间语种回传不死锁，未知原文保存且MT0，唯一结算，旧客户端读取模型凭据前被拒绝。Apple NaturalLanguage在Mac上的四语完整文本观察与iOS SDK桥类型检查通过，均不是iPhone DEVICE证据。共享JSON fixture由Flutter生成同一回传、TS接收校验，非两端各写一个不相干样例。

最新原始回归、源码摘要与限制统一见外层`artifacts/closeout-regression/20260928-qwen31-lid/verification.json`。早期构建顺序/测试fixture失败保留；Flutter分析工具LSP截断失败不计PASS，Dart直接分析及后续回归单独取证。未变化的既有样式info不扩展修复。

仍待同源候选构建、独立新配置的静音/朗读live qualification、Beelink部署、iOS真实文本语种/声学断句/术语及朗读验收。短句如“Okay”、标识如“Hy-MT2”本次Mac观察置信度低，本版不会强行翻译；实际可用语种和效果以设备/组合资格为准，不拿30语供应商目录冒充20语产品交集全部DEVICE通过。原手机VAD、Sortformer、腾讯MT/TTS、界面主流程及客户计费规则不变。

原始证据在外层`artifacts/closeout-regression/20260928-qwen31-selection/`，保护提交与回执摘要以该目录verification.json为准。
