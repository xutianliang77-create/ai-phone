import 'dart:async';

import 'package:flutter/material.dart';

import '../../data/enterprise_meeting_models.dart';
import '../../data/enterprise_meeting_room_client.dart';
import '../../data/enterprise_meeting_screen_share_controller.dart';
import '../../data/enterprise_mobile_api_client.dart';
import '../../data/enterprise_mobile_models.dart';
import '../widgets/enterprise_meeting_room_card.dart';
import '../widgets/enterprise_meeting_media_workspace.dart';
import '../widgets/enterprise_meeting_material_card.dart';
import '../widgets/enterprise_meeting_screen_share_card.dart';
import '../widgets/enterprise_mobile_status_panel.dart';
import '../widgets/enterprise_meeting_translation_card.dart';

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
  String _captionLanguage = 'zh';
  bool _translatedAudioEnabled = false;
  EnterpriseMeetingScreenShareController? _screenShareController;
  EnterpriseMeetingScreenShareSnapshot _screenShare =
      const EnterpriseMeetingScreenShareSnapshot.idle();
  String? _activeParticipantId;
  bool _canShareScreen = false;
  bool _canForceStopScreen = false;

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
      unawaited(_screenShareController?.dispose());
      _screenShareController = null;
      unawaited(_roomClient.disconnect());
      _activeMeetingId = null;
      _activeParticipantId = null;
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    unawaited(_roomSubscription?.cancel());
    unawaited(_screenShareController?.dispose());
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
    final translationCard = EnterpriseMeetingTranslationCard(
      snapshot: _room,
      captionLanguage: _captionLanguage,
      translatedAudioEnabled: _translatedAudioEnabled,
      editable: _room.status == EnterpriseMeetingRoomStatus.disconnected,
      onCaptionLanguage: (value) => setState(() => _captionLanguage = value),
      onTranslatedAudio: (value) =>
          setState(() => _translatedAudioEnabled = value),
    );
    return _PageBody(children: <Widget>[
      if (_room.status == EnterpriseMeetingRoomStatus.disconnected)
        translationCard
      else
        EnterpriseMeetingMediaWorkspace(
          screenTrack: _room.screenShareTrack,
          captions: translationCard,
        ),
      if (_room.status != EnterpriseMeetingRoomStatus.disconnected)
        EnterpriseMeetingRoomCard(
          snapshot: _room,
          onMicrophone: () => _roomClient.setMicrophoneEnabled(
            !_room.microphoneEnabled,
          ),
          onLeave: _leave,
        ),
      if (_screenShareController != null && _activeParticipantId != null)
        EnterpriseMeetingScreenShareCard(
          snapshot: _screenShare,
          participantId: _activeParticipantId!,
          canShare: _canShareScreen,
          canForceStop: _canForceStopScreen,
          supported: _screenShareController!.isSupported,
          onStart: _screenShareController!.start,
          onStop: _screenShareController!.stop,
          onForceStop: _screenShareController!.forceStop,
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
              onPressed: canJoin && !_joining && _activeMeetingId == null
                  ? () => _join(meeting.id)
                  : null,
              icon: const Icon(Icons.login),
              label: Text(
                _activeMeetingId == meeting.id ? '已加入' : '加入会议',
              ),
            ),
            EnterpriseMeetingMaterialCard(
              client: widget.client,
              workspace: widget.workspace,
              aggregate: aggregate,
              canWrite: widget.workspace.context.can('meeting:write') &&
                  (widget.workspace.context.member.role == 'owner' ||
                      widget.workspace.context.member.role == 'admin' ||
                      widget.workspace.context.member.userId ==
                          meeting.hostUserId),
              connected: _activeMeetingId == meeting.id,
              onMeetingChanged: _load,
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
    final workspace = widget.workspace;
    final tenantId = workspace.context.tenant.id;
    setState(() {
      _joining = true;
      _error = null;
    });
    try {
      final meeting = _meetings
          .firstWhere((value) => value.meeting.id == meetingId)
          .meeting;
      final grant = await widget.client.joinMeeting(
        workspace,
        meetingId,
        captionLanguage: _captionLanguage,
        translatedAudioEnabled: _translatedAudioEnabled,
      );
      await _roomClient.connect(grant);
      if (!mounted || widget.workspace.context.tenant.id != tenantId) {
        await _roomClient.disconnect();
        return;
      }
      final canShare = grant.participantRole == 'host' ||
          meeting.screenShareRole == 'members' &&
              grant.participantRole == 'member';
      final controller = EnterpriseMeetingScreenShareController(
        api: widget.client,
        workspace: workspace,
        meetingId: meetingId,
        participantId: grant.participantId,
        onSnapshot: (snapshot) {
          final share = snapshot.share;
          _roomClient.setExpectedScreenSharePublisherIdentity(
            share?.status == 'active' ? share!.publisherIdentity : null,
          );
          if (mounted) setState(() => _screenShare = snapshot);
        },
      );
      _screenShareController = controller;
      controller.startPolling();
      if (mounted) {
        setState(() {
          _activeMeetingId = meetingId;
          _activeParticipantId = grant.participantId;
          _canShareScreen = canShare;
          _canForceStopScreen = workspace.context.can('screen_share:stop');
          _screenShare = const EnterpriseMeetingScreenShareSnapshot.idle();
        });
        await _load();
      }
    } catch (error) {
      if (mounted) setState(() => _error = _errorLabel(error));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  Future<void> _leave() async {
    final screenShare = _screenShareController;
    _screenShareController = null;
    _roomClient.setExpectedScreenSharePublisherIdentity(null);
    if (screenShare != null) {
      await screenShare.stop();
      await screenShare.dispose();
    }
    await _roomClient.disconnect();
    if (mounted) {
      setState(() {
        _activeMeetingId = null;
        _activeParticipantId = null;
        _canShareScreen = false;
        _canForceStopScreen = false;
        _screenShare = const EnterpriseMeetingScreenShareSnapshot.idle();
      });
    }
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

String _meetingTime(EnterpriseMobileMeeting meeting) {
  final time = (meeting.scheduledAt ?? meeting.createdAt).toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${time.year}-${two(time.month)}-${two(time.day)} '
      '${two(time.hour)}:${two(time.minute)}';
}
