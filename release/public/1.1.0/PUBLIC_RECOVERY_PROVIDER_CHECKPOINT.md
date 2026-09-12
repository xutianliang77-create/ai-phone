# 跨进程恢复的 Provider checkpoint 结论（第93批）

当前无界AI的跨进程恢复保持关闭。

Gateway 可以保存可信的接收水位和恢复 owner claim；它们不足以恢复已经断开的 ASR、翻译和 TTS 运行时。现有 Provider/ASR/TTS 接口没有 state export/import 或供应商 session resume 合同；流式 ASR 还持有本地 WebSocket、取消控制器、音频游标、turn/attempt 和供应商 item 状态，TTS 队列持有本地 Promise 与播放 generation。

`lastAcceptedSample` 是 Gateway 已接受 PCM 的水位，不是供应商确认的水位。入队后的积压帧仍可能被背压策略丢弃。新 Gateway 若没有原运行时对象必须关闭恢复，不能读取模型配置或凭据、创建第二 ASR、重放音频或建立替代收费会话。

未来只有在供应商恢复语义、版本化 checkpoint、owner fencing、真实 PostgreSQL 双进程竞争和真实设备验收都具备后，才可重新评估跨进程恢复。当前同进程显式测试恢复不代表跨进程能力。
