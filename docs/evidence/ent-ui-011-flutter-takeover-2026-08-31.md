# ENT-UI-011 Flutter 企业人工接管代码候选

日期：2026-08-31
状态：`in_progress`

## 本批功能

- 新增 Flutter 严格 Support Queue、Work Item、Claim、Session、AI Speech Fence、Communication、Control 和最小
  Workbench 模型；UUID、subject、状态、时间、版本、队列/会话/坐席关联异常均失败闭合。
- 新增 tenant route document 绑定的 Queue/Work Item/Claim/Activate/Get/Renew/Release 客户端；不访问个人 AI
  代打、个人 Call Link 或本地缓存业务状态。
- 接管页从硬编码 `not_ready` 改为真实队列和 SLA 等待项；claim 网络结果未知时保留同一幂等键，不重复生成请求。
- claim 后激活最小 workbench，并分别展示数据库 claim、AI 已停播和 Provider 坐席媒体回执。只有服务端
  `mediaTakeover=ready` 才显示媒体已加入；否则显示明确 reason code。
- claim 按服务端 lease 在租约一半之前、最长30秒续租。App 离开前台、租户切换、租约/真值冲突或401时先清除
  本地控制，再请求 `agent_disconnect` 释放；释放结果未知时由服务端有界租约收敛。
- 主动结束先停止本地控制，再以当前 claim/session version 和稳定幂等键释放，不显示乐观成功。

## 已执行静态门禁

- `flutter analyze`：通过，0 issue。
- `dart format`、350行文件规模和 `git diff --check`：通过。

## 未执行边界

按当前开发顺序，Flutter test、API测试、构建、真机、后台网络切换、动态字体、横竖屏、真实 PostgreSQL、
LiveKit/PSTN 坐席媒体和300ms停播验收均延后。该代码候选不证明真实人工媒体接管或生产门禁通过。
