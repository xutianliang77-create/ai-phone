# ENT-MTG-006 iOS ReplayKit 实现与静态门禁证据

日期：2026-07-19
状态：`in_progress`，代码候选已完成，真实验收未执行

## 实现范围

- Flutter 会议页按服务端 `screenShareRole` 和 participant role 显示 iOS 屏幕共享，沿用 Material 3 与统一 Material Icons，
  提供自动/流畅/高清和开始/停止；非 iOS、无权限、他人占用或撤销 pending 时失败闭合。
- 启动前先验证 ReplayKit target/App Group，再读取最新 meeting version 和申请 `sourceType=screen`、无系统音频租约。
  屏幕使用独立 `Room(autoSubscribe:false)` 与 generation 专属短期 grant，主音频 Room 不获得屏幕发布权限。
- Broadcast Upload Extension 只处理视频样本，经 App Group 固定 Unix socket 交给主 App；扩展不持有 access token、
  API key、tenant credential 或 route document，也不采集 app/mic audio。
- App Group 控制清单只保存 share ID、generation、publisher identity、lease expiry、nonce 和 enabled，使用原子写；
  renew/clear 必须匹配旧代控制键，扩展每秒复核并在过期、删除或不匹配时停止。
- 系统广播开始后手动发布 screen track，首次 renew 绑定 track SID，之后每10秒续租；25秒未确认、系统 stop、离会、
  续租失败或服务端 current generation 改变时先停止本地广播，再幂等结束租约。撤销 pending 保持可见并由 outbox 收敛。
- Runner 与扩展的 bundle ID、App Group 和 development team 均从 xcconfig/build setting 派生，没有硬编码额外生产身份。

## 静态门禁

- `flutter analyze --no-pub`：通过。
- `plutil -lint`：Runner/Extension Info.plist、entitlements 和 Xcode project 均通过。
- `xcodebuild -list -project ios/Runner.xcodeproj`：工程可解析，包含 Runner、EnterpriseBroadcast、RunnerTests targets 和
  EnterpriseBroadcast scheme。
- `xcodebuild -showBuildSettings ... -target EnterpriseBroadcast`：确认 application extension only、独立 bundle ID、
  App Group、entitlements、Info.plist 和 development team 均正确展开。
- `xcrun swiftc -typecheck`：EnterpriseBroadcast 五个 Swift 源文件通过 iOS 17 simulator SDK 静态类型检查。
- `xcrun swiftc -typecheck -F <Flutter.framework>`：Runner `EnterpriseReplayKitBridge.swift` 通过 iOS 17 simulator SDK
  与 Flutter module 静态类型检查。
- 根目录 typecheck、lint、文件规模和 diff 门禁在提交前记录；本文件不把未执行测试写成通过。

## 明确未执行

按本轮“测试先略过”要求，未运行 Flutter/unit/API/Repository/全 Node/Playwright 测试，未执行 iOS build、archive、安装或
覆盖生产 App；未连接真实 LiveKit，未验证真机系统选择器、离开 App、锁屏、控制中心停止、音频中断、Wi-Fi/蜂窝切换、
扩展内存压力/被杀、后台续租、双人竞争、旧 generation/nonce、首帧和撤销时延。

因此本证据不能证明 AC-SHARE-002/006/009/010、A1、H1/H2/H3 或企业生产门禁通过，`ENT-MTG-006` 继续保持
`in_progress`。
