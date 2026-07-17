import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../call_link/data/call_link_api_client.dart';
import '../../../call_link/data/call_room_client.dart';
import '../../data/agent_consult_api_client.dart';
import '../widgets/agent_operator_consult_view.dart';

class AgentOperatorConsultPage extends StatefulWidget {
  const AgentOperatorConsultPage({
    required this.draftId,
    required this.callId,
    required this.callClient,
    required this.roomClient,
    this.consultClient,
    super.key,
  });

  final String draftId;
  final String callId;
  final CallLinkApiClient callClient;
  final CallRoomClient roomClient;
  final AgentConsultApiClient? consultClient;

  @override
  State<AgentOperatorConsultPage> createState() =>
      _AgentOperatorConsultPageState();
}

class _AgentOperatorConsultPageState extends State<AgentOperatorConsultPage> {
  late final AgentConsultApiClient _client = widget.consultClient ??
      AgentConsultApiClient(baseUrl: AppConfig.fromEnvironment().apiBaseUrl);
  final TextEditingController _phoneController = TextEditingController();
  StreamSubscription<CallRoomSnapshot>? _roomSubscription;
  Timer? _pollTimer;
  CallRoomSnapshot _room = const CallRoomSnapshot.disconnected();
  AgentConsult? _consult;
  CallRoomToken? _consultToken;
  CallRoomToken? _mainToken;
  bool _busy = false;
  bool _restoring = false;
  bool _allowPop = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _roomSubscription = widget.roomClient.snapshots.listen((snapshot) {
      if (mounted) setState(() => _room = snapshot);
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    unawaited(_roomSubscription?.cancel());
    _phoneController.dispose();
    if (widget.consultClient == null) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<bool>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop || !await _onWillPop() || !mounted) return;
        setState(() => _allowPop = true);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.of(context).pop(result);
        });
      },
      child: AgentOperatorConsultView(
        consult: _consult,
        room: _room,
        phoneController: _phoneController,
        busy: _busy,
        mainConnected: _mainToken != null &&
            _room.status == CallRoomConnectionStatus.connected,
        error: _error,
        onStart: _start,
        onAccept: _accept,
        onReject: _rejectAndReturn,
        onComplete: _complete,
        onReconnect: _reconnectMain,
        onReturn: () => Navigator.of(context).pop(false),
      ),
    );
  }

  Future<void> _start() async {
    final phone = _phoneController.text.trim();
    if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone)) {
      setState(() => _error = '手机号必须包含国家区号，例如 +8613800000000');
      return;
    }
    await _run(() async {
      final consult = await _client.start(
        draftId: widget.draftId,
        targetPhone: phone,
        idempotencyKey:
            'app-${widget.draftId}-${DateTime.now().microsecondsSinceEpoch}',
      );
      _consult = consult;
      await widget.roomClient.disconnect();
      final token = await _joinWhenMainLeft(consult.id);
      await widget.roomClient.connect(token);
      _consultToken = token;
      _startPolling();
      if (mounted) setState(() {});
    }, restoreOnFailure: true);
  }

  Future<CallRoomToken> _joinWhenMainLeft(String consultId) async {
    Object? lastError;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await _client.join(
          draftId: widget.draftId,
          consultId: consultId,
        );
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await Future<void>.delayed(const Duration(milliseconds: 400));
        }
      }
    }
    throw lastError!;
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => unawaited(_refresh()),
    );
    unawaited(_refresh());
  }

  Future<void> _refresh() async {
    final consult = _consult;
    if (consult == null || _busy) return;
    try {
      final current = await _client.get(
        draftId: widget.draftId,
        consultId: consult.id,
      );
      if (!mounted) return;
      setState(() => _consult = current);
      if (const {'rejected', 'no_answer', 'failed'}.contains(current.status)) {
        _pollTimer?.cancel();
        await _restoreMainOnce();
      } else if (current.status == 'completed') {
        _pollTimer?.cancel();
      }
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _accept() async {
    final consult = _consult;
    final token = _consultToken;
    if (consult == null || token == null) return;
    await _run(() async {
      _consult = await _client.accept(
        draftId: widget.draftId,
        consultId: consult.id,
        participantIdentity: token.participantIdentity,
      );
      await widget.roomClient.disconnect();
      await _connectMain();
      if (mounted) setState(() {});
    });
  }

  Future<void> _reconnectMain() => _run(_connectMain);

  Future<void> _connectMain() async {
    final token = await widget.callClient.createRoomToken(
      callId: widget.callId,
      participantRole: 'host',
      participantName: 'operator-handoff-host',
    );
    await widget.roomClient.connect(token);
    await widget.callClient.confirmRoomConnected(token);
    _mainToken = token;
  }

  Future<void> _complete() async {
    final consult = _consult;
    final token = _mainToken;
    if (consult == null || token == null) return;
    await _run(() async {
      _consult = await _client.complete(
        draftId: widget.draftId,
        consultId: consult.id,
        participantIdentity: token.participantIdentity,
      );
      _pollTimer?.cancel();
      if (mounted) Navigator.of(context).pop(true);
    });
  }

  Future<void> _rejectAndReturn() async {
    await _run(() async {
      await _rejectCurrent();
      await _connectMain();
      if (mounted) Navigator.of(context).pop(false);
    });
  }

  Future<void> _rejectCurrent() async {
    final consult = _consult;
    if (consult != null && !consult.isTerminal) {
      _consult = await _client.reject(
        draftId: widget.draftId,
        consultId: consult.id,
      );
    }
    await widget.roomClient.disconnect();
  }

  Future<void> _restoreMainOnce() async {
    if (_restoring || _mainToken != null) return;
    _restoring = true;
    try {
      await widget.roomClient.disconnect();
      await _connectMain();
      if (mounted) setState(() {});
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      _restoring = false;
    }
  }

  Future<bool> _onWillPop() async {
    final status = _consult?.status;
    if (_busy) return false;
    if (status == 'merged') {
      setState(() => _error = '请先重新进入原通话并确认三方交接完成');
      return false;
    }
    if (const {'requested', 'dialing', 'connected', 'merging'}
        .contains(status)) {
      try {
        await _rejectCurrent();
        await _connectMain();
      } catch (error) {
        if (mounted) setState(() => _error = error);
        return false;
      }
    }
    return true;
  }

  Future<void> _run(
    Future<void> Function() action, {
    bool restoreOnFailure = false,
  }) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (restoreOnFailure) {
        try {
          await _rejectCurrent();
          await _connectMain();
        } catch (_) {}
      }
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
