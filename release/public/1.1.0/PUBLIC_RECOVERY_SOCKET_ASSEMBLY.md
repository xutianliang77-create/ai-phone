# 原恢复Socket装配边界（第89批）

第89批只为原V11-08/26建立受限的控制面接管：显式测试装配`recoverySocketAssembly=true`下，新WebSocket可用同一有效JWT尝试接管已断开的原会话。

## 接管顺序

1. 原断开先写可信`disconnected`水位，并按第88批暂存原Provider、公共sink和暂停TTS队列。
2. 新Socket以原JWT连入，先通过原API sink发起新的`recovery`查询；它必须得到当前授权、原配置/lease/语言/水位完全匹配的回执。
3. 原session map以预期代际作一次性比较交换；取得同进程原对象，不重新取配置或凭据，不创建第二个ASR连接/attempt。
4. 客户端仍须发送原resume控制并收到确认。任何授权失败、状态/代际/水位不符或连接关闭，都拒绝接管，不创建替代会话。

恢复查询不续JWT，也不允许过期JWT恢复。本批没有跨Gateway、数据库或进程重启所有权。

## 音频限制

接管后的`audio.frame`当前明确返回既有`bad_event`错误，不交给批处理、ASR或翻译。这样既不重放断开前PCM，也不接受缺乏手机序号桥接的新PCM。TTS队列和Provider状态已可在控制面复用，但这不是对用户的语音续接承诺。

下一批必须基于可信lastAcceptedSample和手机发送序号定义恢复后的首帧条件；不满足则继续失败/保全，而不是猜测、重放或新建收费会话。默认生产开关保持关闭，本批仅HOST合成验证。
