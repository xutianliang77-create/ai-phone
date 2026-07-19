# ENT-MTG-009 自适应共享布局实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`；仅代码候选与静态证据，不是弱网、真实 LiveKit、浏览器或移动真机验收

## 1. 本次实现

- Web smooth/auto/high capture 上限分别为720p15、1080p15、1440p15；发布显式配置 screen simulcast、
  360p低层、按档位可选720p中层、主编码、maintain-resolution 和 dynacast。
- Web main Room 保存受服务端 current share identity 约束的 `RemoteVideoTrack`，React 用 `attach/detach` 保留
  adaptiveStream 的可见性和元素尺寸注册，不再降成无法反馈尺寸的裸 MediaStreamTrack。
- Flutter iOS/Android publisher 以锁定 `livekit_client 2.8.1` 显式设置三档 capture/publish parameters、simulcast
  layers、maintainResolution 和 dynacast，不新增系统音频或原生权限。
- Flutter main Room 只接受服务端当前 generation 的 `ent-share` identity 和 screen-share video source，
  `VideoTrackRenderer` 上报 Widget 尺寸/像素密度；共享 publisher 不计入远端参会者人数。
- Web/Flutter 均提供画面优先、并排、字幕优先；空间不足或大字体时纵向重排，低高度横屏限制内容高度，关键控制不使用
  overlay 遮挡。

## 2. 静态门禁

本轮按用户要求跳过 unit、API、Repository、migration、Playwright、Flutter test 和真实媒体测试。执行并通过：

- `flutter analyze --no-pub`
- Enterprise Web 定向 typecheck
- 全仓 `npm run typecheck`
- 全仓 `npm run lint`
- Enterprise Web `typecheck:e2e`、生产 build 与非 release bundle 检查（9 files，entry JS 393855 bytes）
- `git diff --check` 和修改生产源文件不超过350行门禁

## 3. 未完成门禁

- 未连接真实 LiveKit 核对实际 RID/layer、dynacast、订阅尺寸、带宽和 CPU。
- 未执行弱网、切后台、元素不可见、Firefox单层降级、旧 generation 或订阅重连矩阵。
- 未执行 Web 320..1280px、200%缩放、手机横屏或 Flutter 1.0/1.5/2.0动态字体真机矩阵。
- 未通过 AC-SHARE-006/007/009、A1、H1/H2/H3 或企业生产门禁。
