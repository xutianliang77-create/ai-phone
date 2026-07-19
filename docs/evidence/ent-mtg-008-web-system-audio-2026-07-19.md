# ENT-MTG-008 Web 系统音频实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`；仅代码候选与静态证据，不是浏览器、真实 LiveKit、移动真机或生产验收

## 1. 本次实现

- Web 只有在用户勾选后请求 `getDisplayMedia` 音频，并以浏览器真实返回的 audio track 为准；没有音轨时在服务端
  acquire 前停止采集并明确失败。
- 复用既有 `meeting.screen_share.system_audio` entitlement、`includesSystemAudio` 契约和 generation 专属 grant；
  客户端严格核对 `screenShareAudio` capability 与实际 capture 一致。
- 独立 publisher Room 分别发布 `screen_share` video 与 `screen_share_audio` audio；初始部分发布失败会失败闭合，video
  结束会停止整次共享，active 后 audio 单独结束只移除音轨并明确降级，保持共享画面；暂停、停止和 dispose 一致收敛。
- 观看端只接受服务端当前 publisher identity 的共享音视频；远端 audio 使用独立 DOM playback 和可见 controls，
  共享者本机不附加捕获音轨，避免本机回放环。
- Enterprise Meeting translation Agent 新增 publication source 必须为 `SOURCE_MICROPHONE` 的守卫，并保留严格成员
  identity 守卫；`ent-share:*` / `SCREEN_SHARE_AUDIO` 不创建 Speech Pipeline。
- iOS ReplayKit 与 Android MediaProjection 没有真实系统音频到 WebRTC audio source 管线，仍固定
  `includesSystemAudio=false` / `screenShareAudio=false`，没有伪造移动端成功。

## 2. 静态门禁

本轮按用户要求跳过 unit、API、Repository、migration、Playwright、Flutter 和真实媒体测试。执行并通过：

- `npm run typecheck --workspace @translation/translation-worker --workspace @translation/enterprise-web --if-present`
- 全仓 `npm run typecheck`
- `npm run typecheck:e2e --workspace @translation/enterprise-web`
- 全仓 `npm run lint`
- `npm run build --workspace @translation/enterprise-web`
- `npm run check:bundle --workspace @translation/enterprise-web`（9 files，entry JS 391742 bytes，非 release metadata 门禁）
- `git diff --check`
- 修改文件规模门禁：生产源文件不超过 350 行

## 3. 未完成门禁

- 未执行 Chrome/Edge/Safari/Firefox 的系统音频能力与权限矩阵。
- 未连接真实 LiveKit 验证双轨发布、部分失败、音轨结束、重连、generation fencing 和远端播放。
- 未执行 entitlement 拒绝、扬声器/耳机回声、错误 ASR/字幕段和多人会议矩阵。
- 未实现或验证 iOS app audio、Android AudioPlaybackCapture，移动端继续明确关闭。
- 未通过 AC-SHARE-008、A1、H2/H3 或企业生产门禁。
