# 原恢复Socket音频桥接边界（第90批）

第90批仅在显式`recoverySocketAssembly=true`测试装配中完成同进程恢复后的首帧安全接续。默认生产开关仍关闭。

## 精确流程

1. 原连接将已确认接收的PCM写入公共sink；sink只从这些实际帧形成`lastAcceptedSample`和`nextSequence`。
2. 新Socket先经当前`recovery`授权、原会话/部署/owner/lease/语言策略和代际比较接管原对象。接管时，API回执水位必须与sink水位完全相同。
3. Gateway发送`session.recovery.ready`。手机只能在`session.resume.recovery`中原样回显这两个值。
4. 原公共sink成功持久`session.resumed`后，Gateway才开放音频；第一帧必须精确等于`nextSequence`，随后帧仍由原sink递增校验。

任一缺失、错水位、错序号、旧代际、撤销授权、持久确认失败或连接关闭都失败关闭：拒绝音频，不重放PCM，不猜测或重置客户端序号，不取新凭据/配置，不开第二ASR或替代收费会话。

首帧通过后复用第88–89批已经保留的原Provider、确认sink与暂停TTS队列。第91批的持久恢复owner claim现仅在显式同进程测试装配中由Gateway接管前消费；若新Gateway没有原运行时对象，第92批只读核验后关闭，不取配置/凭据、不建替代ASR。它不等于跨进程/跨Gateway恢复，也不改变原结束和唯一结算规则。

## 验收边界

合成loopback已覆盖错误桥、跳号首帧、正确首帧进入原批处理、撤销当前授权和无第二模型路径；第94批进一步覆盖恢复后的新原文、译文、TTS输出、正常结束与唯一结算，以及第一条同owner恢复Socket取得原运行时后第二条Socket关闭。手机定向测试覆盖桥回显、仅精确首序号、缺桥关闭和服务端拒绝恢复后立即报错、关闭传输、拒绝继续送音频。

这些仅是HOST合成验证。未做部署、真实模型、真实网络、真机后台/断网、真实PostgreSQL竞争、多进程Provider连续性、持久化端到端fence或JWT续签验收；跨进程/跨Gateway恢复与默认恢复开关均保持关闭。
