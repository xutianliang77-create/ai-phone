# Qwen Audio 3.1 Streaming 主候选：协议已核验，自动路由未接入

2026-09-28用户选择`qwen-audio-3.1-asr-flash-streaming`。本阶段仅完成独立协议准备，不是公有适配器、同源RC或设备验收完成；原模型配置/QA运行态保持。

## 实际供应商证据

一次28秒固定多语言PCM，经同一已授权百炼工作空间的`/api-ws/v1/inference`，以`run-task`/二进制PCM/`finish-task`完成，最长网络运行45秒，无自动重试。使用普通权重4的三个技术热词、语义断句及静音心跳；未上传手机录音或客户历史，未调用MT/TTS。

实际35个事件包括4段最终结果（英、日、法、中）、字级时间戳，以及正常task-finished。结尾用量为input_tokens686/output_tokens50/total_tokens736、duration25；音频实际上传28秒，不把这两个时长混为一谈，也不将Token折算成客户余额。本次中间/最终usage为累计快照且有重复嵌套，不能累加。没有供应商账单或reported-model回读，记录的是请求型号及实际返回字段，不冒充结算金额证明。

本次所有事件没有逐句language字段。这与[官方服务端事件](https://help.aliyun.com/zh/model-studio/fun-asr-server-events)字段表的缺口一致；能自动转写不等于能够直接沿用当前Qwen3的供应商语种证据。静音心跳、语义断句、即时热词及任务事件参见[客户端协议](https://help.aliyun.com/zh/model-studio/fun-asr-client-events)；endpoint参见[接入指南](https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api)。

## 已完成的可独立代码

原ASR目录内增加新协议的请求/结束消息、真实结果解析、字级时间合法性与可证明的字符对齐、累计Token用量去重。未增加另一条App/业务Provider。无语种时明确not_reported，不写默认中文或伪造供应商language。未发布新protocol选项到配置页/公有工厂，避免半成品被切入现有自动模式。

真实回包fixture通过；ASR回归23文件299项、Gateway构建、行数/diff、双版本40/40通过。初次TypeScript类型收窄失败已修，失败回执保留。没有用HOST模块测试代替完整WebSocket生命周期、真实产品attempt journal或客户结算验证。

## 必须解决的选择

为保留自动识别/自动反向，已询问用户：优先复用iPhone NaturalLanguage文本语种识别，还是先取得供应商逐句语种输出确认。现有AppleTextLanguageObservation仅受WUJIE_APPLE_FILE_PROBE控制的QA观察，尚非生产路由。

若选择手机路径，应沿原实时事件加入当前会话/片段/revision绑定的文本语种请求与回传；服务器按已授权语种范围核验，不把文本判断冒充声学证据，不对短句/歧义静默猜中文。完成该接口、超时/过期/重复/跨账号拒绝和手机实际证据后，才能接入原Provider的MT派发、配置快照与新资格。Android等未接语言能力的客户端不能被iOS证据替代。

仍待：完整client生命周期与attempt、配置入口、语言回传决策、对应新资格、同源部署与手机旅程。不得将本文件理解为“已切换至3.1”。原VAD、Sortformer、腾讯MT/TTS、历史及计费边界不变。

原始证据在外层`artifacts/closeout-regression/20260928-qwen31-selection/`，保护提交与回执摘要以该目录verification.json为准。
