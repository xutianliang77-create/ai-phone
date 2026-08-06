import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../../call_link/data/livekit_call_room_client.dart';
import '../../data/ai_calling_agent_api_client.dart';
import 'agent_operator_consult_page.dart';

class AgentCallTakeoverPage extends StatefulWidget {
  const AgentCallTakeoverPage({
    required this.draftId,
    required this.callId,
    this.takeoverReadyAt,
    this.agentClient,
    this.callClient,
    this.roomClient,
    super.key,
  });

  final String draftId;
  final String callId;
  final String? takeoverReadyAt;
  final AiCallingAgentApiClient? agentClient;
  final CallLinkApiClient? callClient;
  final CallRoomClient? roomClient;

  @override
  State<AgentCallTakeoverPage> createState() => _AgentCallTakeoverPageState();
}

class _AgentCallTakeoverPageState extends State<AgentCallTakeoverPage> {
  late final AiCallingAgentApiClient _agentClient = widget.agentClient ??
      AiCallingAgentApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final CallLinkApiClient _callClient = widget.callClient ??
      CallLinkApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  late final CallRoomClient _roomClient =
      widget.roomClient ?? LiveKitCallRoomClient();
  late final bool _ownsRoomClient = widget.roomClient == null;
  StreamSubscription<CallRoomSnapshot>? _roomSubscription;
  Timer? _pollTimer;
  CallRoomSnapshot _room = const CallRoomSnapshot.disconnected();
  bool _ready = false;
  bool _busy = false;
  bool _ended = false;
  bool _acceptInFlight = false;
  bool _accepted = false;
  String? _participantIdentity;
  String? _notice;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _ready = widget.takeoverReadyAt != null;
    _roomSubscription = _roomClient.snapshots.listen((snapshot) {
      if (mounted) setState(() => _room = snapshot);
    });
    _pollTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => unawaited(_refresh()),
    );
    unawaited(_refresh());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    unawaited(_roomSubscription?.cancel());
    if (_ownsRoomClient) unawaited(_roomClient.dispose());
    if (widget.agentClient == null) _agentClient.close();
    if (widget.callClient == null) _callClient.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final connected = _room.status == CallRoomConnectionStatus.connected;
    return Scaffold(
      appBar: AppBar(title: const Text('人工接管通话')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Icon(
                connected ? Icons.headset_mic : Icons.support_agent,
                size: 56,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(
                _ended
                    ? '通话已结束'
                    : _accepted
                        ? '已接入，请直接与对方通话'
                        : connected
                            ? '已加入人工通话房间，等待 AI 停止发言…'
                            : _ready
                                ? 'AI 已停止发言，可以安全接入'
                                : '可先加入房间，AI 停止发言后会自动完成接管',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                '远端参与者：${_room.remoteParticipantCount} · '
                '麦克风：${_room.microphoneEnabled ? '已开启' : '未开启'}',
                textAlign: TextAlign.center,
              ),
              if (_busy) ...[
                const SizedBox(height: 20),
                const LinearProgressIndicator(),
              ],
              if (_error != null) ...[
                const SizedBox(height: 20),
                Text(
                  '操作失败：$_error',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              if (_notice != null) ...[
                const SizedBox(height: 12),
                Text(_notice!, textAlign: TextAlign.center),
              ],
              const Spacer(),
              if (!connected && !_ended)
                FilledButton.icon(
                  onPressed: !_busy ? _connect : null,
                  icon: const Icon(Icons.call),
                  label: Text(_ready ? '进入人工通话' : '加入人工通话（等待 AI）'),
                ),
              if (!connected && !_ended) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _resumeAgent,
                  icon: const Icon(Icons.smart_toy_outlined),
                  label: const Text('取消接管，让 AI 继续'),
                ),
              ],
              if (connected && !_ended) ...[
                FilledButton.icon(
                  onPressed: _busy ? null : _openOperatorConsult,
                  icon: const Icon(Icons.support_agent),
                  label: const Text('咨询并转接外部坐席'),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _busy ? null : _hangup,
                  icon: const Icon(Icons.call_end),
                  label: const Text('结束本次通话'),
                  style: FilledButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
              const SizedBox(height: 8),
              const Text(
                '离开页面只会退出本机接管；请使用“结束本次通话”终止电话线路。',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _refresh() async {
    if (_ended) return;
    try {
      final draft = await _agentClient.getDraft(draftId: widget.draftId);
      if (!mounted) return;
      if (draft.takeoverReadyAt != null) {
        if (!_ready) setState(() => _ready = true);
        await _acceptIfReady();
      } else if (draft.status == 'completed' ||
          draft.status == 'failed' ||
          draft.status == 'cancelled') {
        _pollTimer?.cancel();
        setState(() => _ended = true);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _connect() async {
    await _run(() async {
      final token = await _callClient.createRoomToken(
        callId: widget.callId,
        participantRole: 'host',
        participantName: 'human-takeover',
      );
      try {
        await _roomClient.connect(token);
        await _callClient.confirmRoomConnected(token);
        _participantIdentity = token.participantIdentity;
        if (_ready) {
          await _acceptIfReady();
        } else if (mounted) {
          setState(() => _notice = '已加入房间，等待 AI 停止发言；就绪后自动接管。');
        }
      } catch (_) {
        await _roomClient.disconnect();
        rethrow;
      }
    });
  }

  Future<void> _acceptIfReady() async {
    final participantIdentity = _participantIdentity;
    if (!_ready ||
        _accepted ||
        _acceptInFlight ||
        participantIdentity == null) {
      return;
    }
    if (_room.status != CallRoomConnectionStatus.connected) return;
    _acceptInFlight = true;
    try {
      await _agentClient.acceptTakeover(
        draftId: widget.draftId,
        participantIdentity: participantIdentity,
      );
      if (mounted) {
        setState(() {
          _accepted = true;
          _notice = '人工接管已确认。';
        });
      }
    } finally {
      _acceptInFlight = false;
    }
  }

  Future<void> _hangup() async {
    await _run(() async {
      // AI calls are carrier-backed Air780 sessions. The legacy SIP control
      // route cannot hang them up and returns livekit_sip_not_configured.
      // Cancel through the AI draft route so the server resolves the active
      // provider operation and issues phone_hangup to the same call binding.
      await _agentClient.cancelDraft(
        draftId: widget.draftId,
        reason: 'human_takeover_hangup',
      );
      final hangup = _agentClient.lastCancellation;
      await _roomClient.disconnect();
      _pollTimer?.cancel();
      if (mounted) {
        setState(() {
          _ended = true;
          _notice = switch (hangup?.status) {
            'accepted' => '已结束本次通话，已向 Air780 发送挂断请求。',
            'requested' => '已结束本次通话，运行时正在处理挂断。',
            'unknown' => '已结束任务，但电话挂断结果待对账。',
            'failed' => '任务已取消，但电话挂断失败，请刷新确认线路状态。',
            _ => '已结束本次通话。',
          };
        });
      }
    });
  }

  Future<void> _openOperatorConsult() async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AgentOperatorConsultPage(
          draftId: widget.draftId,
          callId: widget.callId,
          callClient: _callClient,
          roomClient: _roomClient,
        ),
      ),
    );
  }

  Future<void> _resumeAgent() async {
    await _run(() async {
      await _agentClient.rejectTakeover(draftId: widget.draftId);
      if (mounted) Navigator.of(context).pop();
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
