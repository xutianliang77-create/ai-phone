# iOS 安装后闪退根因与修复

版本：v1.0  
日期：2026-07-11  
状态：根因已确认，流程修复和连续启动验收已通过

## 1. 现象

App 通过 Flutter Debug 模式安装到 iPhone 后，脱离 Flutter tooling 或 Xcode，从桌面图标启动时立即退出。重新用 Profile 模式安装后可以独立启动。

## 2. 证据

- 项目日志已记录 iOS 输出：`Cannot create a FlutterEngine instance in debug mode without Flutter tooling or Xcode`，随后 signal 11。
- 崩溃文件：`data/model-eval/iphone14-small-models/results/crashlogs/Runner-2026-07-08-085620.ips`。
- 崩溃类型：`EXC_BAD_ACCESS / SIGSEGV`。
- 首个业务 Dart 代码执行前，主线程崩溃在 Flutter Engine：
  - `VSyncClient initWithTaskRunner`
  - `FlutterViewController createTouchRateCorrectionVSyncClientIfNeeded`
  - `FlutterViewController viewDidLoad`
- 崩溃包包含 `Runner.debug.dylib`。
- 同一设备改装 Profile 包后，项目日志记录独立启动 8–10 秒仍在运行且无新崩溃报告。

该签名与 Flutter 官方问题一致：

- https://github.com/flutter/flutter/issues/153971
- https://github.com/flutter/flutter/issues/168582

## 3. Five Whys

1. 为什么点击图标后闪退：Flutter Engine 在启动期发生 SIGSEGV。
2. 为什么 Flutter Engine 崩溃：Debug FlutterEngine 脱离 Flutter tooling/Xcode 创建，VSync 初始化失败。
3. 为什么脱离 tooling 启动 Debug 包：安装后交给用户从桌面手动测试。
4. 为什么会反复安装 Debug 包：没有独立的真机测试安装命令和 build mode 门禁。
5. 为什么问题重复出现：构建、安装、独立启动和崩溃检查没有形成一次自动流程。

根因属于安装发布流程，不是账号、网络、ASR、TTS 或业务初始化代码。

## 4. 修复

新增 `scripts/install_ios_profile_test.sh`：

- 强制 `flutter build ios --profile`。
- 要求显式 `DEVICE_ID` 和统一服务器 `SERVER_BASE_URL`。
- 拒绝 localhost 服务器地址。
- 构建后检查 App 中不存在 `Runner.debug.dylib`。
- 使用 `devicectl` 安装并独立启动，不依赖 Flutter run 会话。

使用方式：

```bash
DEVICE_ID=00008120-00083592346BC01E \
SERVER_BASE_URL=https://your-test-server.example.cn \
scripts/install_ios_profile_test.sh
```

Debug 使用规则：

- 需要断点和热重载时，使用 Xcode 或 `flutter run` 保持调试器连接。
- 交给用户从桌面测试时，只能安装 Profile 或 Release。
- Debug 包不得作为“修复后 App”或真机验收证据。

## 5. 验收

流程修复只有完成以下测试后才标记 accepted：

1. 卸载旧 App。
2. 用稳定安装脚本安装 Profile 包。
3. 从桌面冷启动、关闭、再次启动，共 20 次。
4. 每次均进入首屏，不依赖 Xcode/Flutter tooling。
5. 检查期间无新增 `cn.qkxy.realtimeinterpreter`/Runner `.ips`。
6. 如果 Profile/Release 出现新崩溃，按新堆栈另立问题，不能继续归因于 Debug 启动限制。

### 2026-07-11 验收结果

- Profile 产物构建和真机安装成功，产物不包含 `Runner.debug.dylib`。
- 清理旧安装容器的残留进程后，完成 20 次 `devicectl --terminate-existing` 独立冷启动。
- 20 次均启动成功，每次都能查到当前 Profile 安装容器的新进程。
- 启动后检查 `systemCrashLogs`，没有新增 2026-07-11 Runner `.ips`。
- `OPT-IOS-001` 和 `OPT-IOS-002` 本轮验收通过。
