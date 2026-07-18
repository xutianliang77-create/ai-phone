# ENT-MTG-007 Android MediaProjection 实现与静态门禁证据

日期：2026-07-19
状态：`in_progress`，代码候选已完成，真实验收未执行

## 实现范围

- Flutter 会议页按服务端 `screenShareRole` 和 participant role 显示 Android 屏幕共享，沿用 iOS/Web 的 Material 3 卡片、
  `mobile_screen_share_outlined` / `stop_screen_share_outlined` 图标和自动/流畅/高清三档，不新增另一套状态真值。
- Android 13+ 先请求可见通知权限，再调用固定 `flutter_webrtc 1.4.0` 的一次性 MediaProjection 授权；用户拒绝时不读取
  meeting version、不 acquire 租约、不连接 RTC。
- acquire 后先启动 `foregroundServiceType=mediaProjection`、`START_NOT_STICKY` 的前台 Service并确认已进入前台，
  再用 generation 专属短期 grant 连接独立 `Room(autoSubscribe:false)` 并发布 screen video；系统音频固定关闭。
- Service 只接收 share ID、generation、publisher identity、lease expiry 和随机 nonce，不接收或持久化 access token、
  RTC URL、tenant route、API key、屏幕帧或音频。
- 前台通知明确显示正在共享、不包含系统音频和停止操作，使用与 Flutter 相同语义的 Material vector；通知停止、
  MediaProjection 系统停止、租约到期、Service 意外销毁、离会和续租失败均进入同一 Flutter/服务端停止状态机。
- 屏幕轨发布后按 capture track ID 核对 WebRTC screen capturer 并追加系统 stop callback；固定插件结构不匹配时返回
  `media_projection_monitor_unavailable` 并失败闭合，不在无法观测系统停止时显示共享成功。
- 首次 native activation 成功后才 renew 绑定 track SID，之后每10秒续租；25秒无轨、服务端 generation 改变或本地
  lifecycle 结束时先停止独立 publisher，再幂等结束租约。Flutter 消失时设备端 lease timer 与服务端 cell Worker 最终回收。

## 静态门禁

- `flutter analyze --no-pub`：通过。
- `xmllint --noout`：AndroidManifest、三份 strings 和两份 Material notification vector 均可解析。
- Gradle 9.1.0 offline `:app:compileDebugKotlin`：通过；只执行 Flutter/Android 资源与 Kotlin/Java 编译任务，未执行测试、
  APK packaging、签名、安装或设备操作。现有插件使用旧 Kotlin Gradle Plugin/Java 8 的告警不属于本任务改动。
- 根目录 typecheck、lint、文件规模和 diff 门禁在提交前记录；本文件不把未执行测试写成通过。

## 明确未执行

按本轮“测试先略过”要求，未运行 Flutter/unit/API/Repository/全 Node/Playwright 测试，未执行 APK 打包、签名、安装或
覆盖生产 App；未连接真实 LiveKit，未验证 Android 13/14/15 真机的通知/MediaProjection 权限接受、拒绝和取消，
也未验证系统状态栏停止、通知停止、离开 App、锁屏、Activity 重建、进程/Service 被杀、Wi-Fi/蜂窝切换、后台续租、
双人竞争、旧 generation/nonce、真实首帧和撤销时延。

因此本证据不能证明 AC-SHARE-006/009/010/011、A1、H1/H2/H3 或企业生产门禁通过，`ENT-MTG-007` 继续保持
`in_progress`。
