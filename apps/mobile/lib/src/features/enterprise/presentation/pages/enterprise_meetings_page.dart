import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_models.dart';
import '../../data/enterprise_meeting_room_client.dart';
import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';
import '../widgets/enterprise_mobile_status_panel.dart';

class EnterpriseMeetingsPage extends StatefulWidget {
  const EnterpriseMeetingsPage({
    required this.client,
    required this.workspace,
    super.key,
  });

  final EnterpriseMobileApiClient client;
  final EnterpriseMobileWorkspace workspace;

  @override
  State<EnterpriseMeetingsPage> createState() => _EnterpriseMeetingsPageState();
}

class _EnterpriseMeetingsPageState extends State<EnterpriseMeetingsPage> {
  final EnterpriseMeetingRoomClient _roomClient = EnterpriseMeetingRoomClient();
  StreamSubscription<EnterpriseMeetingRoomSnapshot>? _roomSubscription;
  EnterpriseMeetingRoomSnapshot _room =
      const EnterpriseMeetingRoomSnapshot.disconnected();
  List<EnterpriseMobileMeetingAggregate> _meetings = const [];
  String? _activeMeetingId;
  String? _error;
  bool _loading = true;
  bool _joining = false;

  @override
  void initState() {
    super.initState();
    _roomSubscription = _roomClient.snapshots.listen((snapshot) {
      if (mounted) setState(() => _room = snapshot);
    });
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant EnterpriseMeetingsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.workspace.context.tenant.id !=
        widget.workspace.context.tenant.id) {
      unawaited(_roomClient.disconnect());
      _activeMeetingId = null;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    unawaited(_roomSubscription?.cancel());
    unawaited(_roomClient.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.workspace.context.can('meeting:read')) {
      return const _PageBody(children: <Widget>[
        EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.forbidden,
          description: '当前成员缺少 meeting:read，未读取企业会议。',
        ),
      ]);
    }
    return _PageBody(children: <Widget>[
      if (_room.status != EnterpriseMeetingRoomStatus.disconnected)
        _RoomCard(
          snapshot: _room,
          onMicrophone: () => _roomClient.setMicrophoneEnabled(
            !_room.microphoneEnabled,
          ),
          onLeave: _leave,
        ),
      if (_loading)
        const EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.loading,
          description: '正在读取当前企业的会议。',
        )
      else if (_error != null)
        EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.notReady,
          title: '会议数据未就绪',
          description: _error!,
          action: OutlinedButton.icon(
            onPressed: _load,
            icon: const Icon(Icons.refresh),
            label: const Text('重新读取'),
          ),
        )
      else if (_meetings.isEmpty)
        const EnterpriseMobileStatusPanel(
          status: EnterpriseMobileStatus.empty,
          description: '当前企业还没有会议。',
        )
      else
        ..._meetings.map(_meetingCard),
    ]);
  }

  Widget _meetingCard(EnterpriseMobileMeetingAggregate aggregate) {
    final meeting = aggregate.meeting;
    final joinable = const <String>{'scheduled', 'provisioning', 'active'}
        .contains(meeting.status);
    final role = widget.workspace.context.member.role;
    final canJoin = role != 'auditor' && joinable;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(children: <Widget>[
              Icon(
                Icons.groups_outlined,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  meeting.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Text(_statusLabel(meeting.status)),
            ]),
            const SizedBox(height: 12),
            Text('${aggregate.participantCount} 位参会者 · '
                '${aggregate.communicationStatus ?? 'not_ready'}'),
            const SizedBox(height: 4),
            Text(
              _meetingTime(meeting),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: canJoin && !_joining && _activeMeetingId != meeting.id
                  ? () => _join(meeting.id)
                  : null,
              icon: const Icon(Icons.login),
              label: Text(
                _activeMeetingId == meeting.id ? '已加入' : '加入会议',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final meetings = await widget.client.listMeetings(widget.workspace);
      if (mounted) setState(() => _meetings = meetings);
    } catch (error) {
      if (mounted) setState(() => _error = _errorLabel(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _join(String meetingId) async {
    setState(() {
      _joining = true;
      _error = null;
    });
    try {
      final grant =
          await widget.client.joinMeeting(widget.workspace, meetingId);
      await _roomClient.connect(grant);
      if (mounted) setState(() => _activeMeetingId = meetingId);
    } catch (error) {
      if (mounted) setState(() => _error = _errorLabel(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  Future<void> _leave() async {
    await _roomClient.disconnect();
    if (mounted) setState(() => _activeMeetingId = null);
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({
    required this.snapshot,
    required this.onMicrophone,
    required this.onLeave,
  });

  final EnterpriseMeetingRoomSnapshot snapshot;
  final Future<void> Function() onMicrophone;
  final Future<void> Function() onLeave;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Wrap(
          spacing: 10,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Text('${_roomStatus(snapshot.status)} · '
                '${snapshot.remoteParticipantCount} 位远端参会者'),
            OutlinedButton.icon(
              onPressed: onMicrophone,
              icon:
                  Icon(snapshot.microphoneEnabled ? Icons.mic : Icons.mic_off),
              label: Text(snapshot.microphoneEnabled ? '静音' : '打开麦克风'),
            ),
            OutlinedButton(
              onPressed: onLeave,
              child: const Text('离开会议'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PageBody extends StatelessWidget {
  const _PageBody({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: children,
      );
}

String _errorLabel(Object error) {
  if (error is EnterpriseMobileApiException) {
    if (error.code == 'meeting_not_started') return '会议尚未开始。';
    if (error.statusCode == 401 || error.statusCode == 403) {
      return '当前身份无权入会。';
    }
    if (error.statusCode == 503) return '企业会议或 RTC Provider 尚未就绪。';
  }
  return '会议请求失败；未回退到个人 Call Link 或示例数据。';
}

String _statusLabel(String status) => switch (status) {
      'scheduled' => '已预约',
      'provisioning' => '准备中',
      'active' => '进行中',
      'ending' => '结束中',
      'ended' => '已结束',
      'cancelled' => '已取消',
      'failed' => '失败',
      _ => status,
    };

String _roomStatus(EnterpriseMeetingRoomStatus status) => switch (status) {
      EnterpriseMeetingRoomStatus.connecting => '正在连接',
      EnterpriseMeetingRoomStatus.connected => '已连接',
      EnterpriseMeetingRoomStatus.reconnecting => '正在重连',
      EnterpriseMeetingRoomStatus.disconnected => '已断开',
    };

String _meetingTime(EnterpriseMobileMeeting meeting) {
  final time = (meeting.scheduledAt ?? meeting.createdAt).toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${time.year}-${two(time.month)}-${two(time.day)} '
      '${two(time.hour)}:${two(time.minute)}';
}
