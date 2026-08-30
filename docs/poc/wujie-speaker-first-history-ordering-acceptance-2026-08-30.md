# 无界AI speaker-first 保存记录顺序验收

日期：2026-08-30

状态：`FAIL_CHILD_SEGMENT_CHRONOLOGICAL_ORDER → LOCAL_FIX_PASS / NOT_DEPLOYED`
方式：复用已保存AliMeeting session；不新建会话、不录音、不播放音频

## 验收对象

- server candidate：`wujie-speaker-first-0779473-20260829T131523Z-runtime`
- source commit/tree：`0779473448ebfa71fc558c478a96f679936b6747 / e874b64625168e4fa4a1f04945d7631bcaf78049`
- primary session：`7dd249ce-785e-44b8-b8aa-69471478c716`
- repeated server evidence：`dfc13cbb-feca-4e3d-b0f9-9d4f94bc750c`
- expected final speaker run：`speaker_1 → speaker_2 → speaker_1`

两个session均已通过模型侧speaker-first门：request/completed/accepted/error=`1/1/1/0`、2 parent→4 child、
字符守恒、4/4 child翻译非空。此处只验收保存记录/API/iOS消费顺序，不重测模型。

## 账号边界

- 两个speaker-first session的owner均为`guest-user`。
- 当前隔离iPhone候选登录账号为`user_82d2d542-4894-4484-86ca-d364720b2875`。
- iPhone账号不能直接读取guest session；本轮没有复制token、改owner、写入新记录或重新播放音频。
- API启用隔离test auto account，因此可用无Authorization的只读GET取得guest session详情。

## API真实返回顺序

`GET /sessions/7dd249ce-785e-44b8-b8aa-69471478c716`返回7段。按API数组顺序压缩speaker：

`speaker_1 → speaker_2 → speaker_1 → speaker_2 → speaker_1`

| API位置 | segment | speaker | startMs | 内容摘要 |
| ---: | --- | --- | ---: | --- |
| 0 | `qwen3_seg_123` | speaker_1 | 1788022835292 | `……看法，那` |
| 1 | `qwen3_seg_354` | speaker_2 | 1788022852332 | `我觉得……目标人群……` |
| 2 | `qwen3_seg_380` | speaker_2 | 1788022855852 | `那么确定……年轻人之间` |
| 3 | `qwen3_seg_618` | speaker_1 | 1788022874732 | `反正这个……那咱们` |
| 4 | `qwen3_seg_775` | speaker_1 | 1788022887532 | `后面再定……` |
| 5 | `qwen3_seg_123:speaker:1` | speaker_2 | 1788022851932 | `我觉得咱们这个` |
| 6 | `qwen3_seg_380:speaker:1` | speaker_1 | 1788022873092 | `好` |

两个speaker-first child的时间戳分别位于原数组中段，却被持久化到数组末尾。

如果只按已持久化timing做稳定排序，正确顺序应为：

| 时间顺序 | 原API位置 | segment | speaker | startMs |
| ---: | ---: | --- | --- | ---: |
| 0 | 0 | `qwen3_seg_123` | speaker_1 | 1788022835292 |
| 1 | 5 | `qwen3_seg_123:speaker:1` | speaker_2 | 1788022851932 |
| 2 | 1 | `qwen3_seg_354` | speaker_2 | 1788022852332 |
| 3 | 2 | `qwen3_seg_380` | speaker_2 | 1788022855852 |
| 4 | 6 | `qwen3_seg_380:speaker:1` | speaker_1 | 1788022873092 |
| 5 | 3 | `qwen3_seg_618` | speaker_1 | 1788022874732 |
| 6 | 4 | `qwen3_seg_775` | speaker_1 | 1788022887532 |

按时间顺序压缩speaker才是预期的：

`speaker_1 → speaker_2 → speaker_1`

## 源码消费链证明

当前链路没有任何一层修正该顺序：

1. `services/api-server/src/infrastructure/storage/sqlite-session-children-store.ts:93`
   按`position`读取；`:99`按`session.segments`当前数组位置重新写入。
2. `services/api-server/src/modules/sessions/session-mappers.ts:23`
   `toSessionDetail`原样返回`session.segments`。
3. `apps/mobile/lib/src/features/history/data/session_history_models.dart:179`
   Flutter按JSON数组原顺序`.map(...).toList()`，没有按timing排序。
4. `apps/mobile/lib/src/features/history/presentation/widgets/session_transcript_tab.dart:52`
   transcript tab仅filter，不排序，随后按list index渲染。
5. `apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_controller.dart:286`
   实时字幕也按`Map`插入顺序重建列表；晚到的新child会追加在末尾。

因此无需再次真机播放即可确定：当前实时字幕和保存记录都会把晚到child显示在末尾，而不是插回speaker边界位置。

## 影响

- 用户看到的speaker run会从正确的A→B→A变成A→B→A→B→A。
- 新child原文和译文会出现在会议记录末尾，脱离上下文。
- TXT/Markdown/CSV导出同样沿用`session.segments`顺序，时间线错误。
- 会议纪要、术语和待办若使用该数组，也会消费错误语序。
- 这不会否定模型的exact2、字符守恒或翻译成功，但会否定“产品已经按speaker正确分句并呈现”的结论。

另有一个已知但独立的问题：child `我觉得咱们这个`与相邻speaker_2原段存在同speaker文本重复；该项不能通过排序修复，
继续保留为独立dedupe TODO。

## 门禁结论

| 子门 | 结果 |
| --- | --- |
| session可只读复用 | PASS |
| child speaker标签 | PASS |
| child原文非空 | PASS |
| child译文非空 | PASS |
| API按时间顺序返回 | **FAIL** |
| 保存记录speaker run为A→B→A | **FAIL** |
| 实时字幕晚到child插回边界 | **FAIL（源码证明）** |
| 导出/纪要消费正确语序 | **FAIL/RISK** |

总体：`FAIL_CHILD_SEGMENT_CHRONOLOGICAL_ORDER`。

## 修复结果

本地修复已完成，但尚未构建候选或部署：

- API新增统一的fail-closed稳定时间排序；未来`mergeSessionSegments`和实时`upsertSegment`在每次写入时生成规范position。
- 旧SQLite记录无需迁移：session detail、JSON/TXT/Markdown/CSV export、列表摘要和本地/远程review在读取时使用同一规范顺序。
- Flutter history JSON解析和实时Controller共用同一稳定排序；晚到child会插回`timing.startMs`位置，而不是按到达顺序追加。
- 任一段缺timing、start/end异常、`overlap=true`或`activeSpeakerIds>1`时，整个列表保持原顺序，不猜测。
- 相同startMs保持原到达顺序；同speaker文本重复没有在本次改动中处理。

用当前保存session `7dd249ce…` 的真实API payload执行新本地排序后，ID顺序变为：

```text
qwen3_seg_123
qwen3_seg_123:speaker:1
qwen3_seg_354
qwen3_seg_380
qwen3_seg_380:speaker:1
qwen3_seg_618
qwen3_seg_775
```

压缩speaker run恢复为：`speaker_1 → speaker_2 → speaker_1`。

验证结果：

- 修复前红灯：API排序用例1 FAIL；Flutter history/live各1 FAIL。
- 修复后聚焦：API 3 files / 16 tests PASS；Flutter新增3 tests PASS。
- API全量：185 files / 682 tests PASS。
- Flutter全量：492/492 PASS；analyze 0。
- workspace build、typecheck、lint、350行门、root npm test与`git diff --check`均PASS。

机器证据：
`.cache/server-candidates/wujie-speaker-first-0779473-20260829T131523Z/evidence/history-ordering-fix-validation-20260830.json`。

当前严格状态：`CODE_PASS / SAVED_FIXTURE_PASS / NOT_BUILT / NOT_DEPLOYED / DEVICE_RETEST_NOT_REQUIRED`。

## 实施边界

1. server在merge/upsert时使用现有authoritative timing原子重排`SessionRecord.segments`；未来SQLite position随之规范化。
2. API详情、导出、列表摘要和review统一消费规范顺序；旧记录读取时即时修正，不改写历史数据库。
3. 实时客户端使用事件已有timing插入child，不增加或猜测新的ordering字段。
4. 无timing、重叠timing、异常区间或多active speaker时fail closed，保持原序。
5. 排序修复与同speaker重复去重分开；本轮没有删除或改写任何文本。
6. 回归断言API和Flutter压缩speaker run均为A→B→A，并覆盖晚到child、相同start、缺timing、overlap和旧记录读取。

本轮修改本地代码与测试，但没有修改数据库、账号、既有session、服务、模型或部署。
