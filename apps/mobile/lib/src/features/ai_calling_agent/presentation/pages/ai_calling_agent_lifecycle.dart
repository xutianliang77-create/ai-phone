part of 'ai_calling_agent_page.dart';

extension _AiCallingAgentLifecycle on _AiCallingAgentPageState {
  Future<void> _loadDrafts() async {
    if (_draftsLoading) return;
    _updateState(() {
      _draftsLoading = true;
      _draftsError = null;
    });
    try {
      final drafts = await _client.listDrafts();
      if (mounted) _updateState(() => _drafts = drafts);
    } catch (error) {
      if (mounted) _updateState(() => _draftsError = error);
    } finally {
      if (mounted) _updateState(() => _draftsLoading = false);
    }
  }

  void _selectDraft(AiCallingAgentDraft draft) {
    _updateState(() {
      _draft = draft;
      _error = null;
      _notice = '已打开任务。';
    });
    unawaited(_syncDraftLifecycle(draft));
    _scrollToDraft();
  }

  void _setDraft(AiCallingAgentDraft draft) {
    _draft = draft;
    _drafts = <AiCallingAgentDraft>[
      draft,
      ..._drafts.where((item) => item.id != draft.id),
    ];
    unawaited(_syncDraftLifecycle(draft));
  }

  Future<void> _syncDraftLifecycle(AiCallingAgentDraft draft) async {
    if (_isPollingStatus(draft.status) || _awaitingPhoneCleanup(draft)) {
      _pollTimer ??= Timer.periodic(
        const Duration(seconds: 2),
        (_) => unawaited(_fetchDraft(showNotice: false)),
      );
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
    if (draft.status == 'in_progress' && draft.callId != null) {
      await _connectRoomForMonitoring(draft);
    } else if (_roomCallId != null) {
      await _disconnectRoomForTakeover();
    }
  }

  bool _isPollingStatus(String status) {
    return status == 'queued' ||
        status == 'dispatching' ||
        status == 'reconciliation_required' ||
        status == 'in_progress' ||
        status == 'takeover_requested';
  }

  bool _awaitingPhoneCleanup(AiCallingAgentDraft draft) {
    return draft.status == 'cancelled' &&
        draft.callId != null &&
        draft.executionProvider == 'air780_volte' &&
        draft.carrierState != 'disconnected' &&
        draft.carrierState != 'busy' &&
        draft.carrierState != 'failed';
  }

  Future<void> _connectRoomForMonitoring(AiCallingAgentDraft draft) {
    final callId = draft.callId!;
    final active = _roomSync;
    if (active != null) return active;
    if (_roomCallId == callId &&
        _roomSnapshot.status != CallRoomConnectionStatus.disconnected) {
      return Future<void>.value();
    }
    final task = _connectRoomForMonitoringOnce(draft);
    _roomSync = task;
    return task.whenComplete(() {
      if (identical(_roomSync, task)) _roomSync = null;
    });
  }

  Future<void> _connectRoomForMonitoringOnce(
    AiCallingAgentDraft draft,
  ) async {
    final callId = draft.callId!;
    try {
      final token = await _callClient.createRoomToken(
        callId: callId,
        participantRole: 'host',
        participantName: 'ai-monitor',
      );
      await _roomClient.connect(token, enableMicrophone: false);
      try {
        await _callClient.confirmRoomConnected(token);
      } catch (_) {
        await _roomClient.disconnect();
        rethrow;
      }
      _roomCallId = callId;
      await _voiceControl?.start(
        draftId: draft.id,
        participantIdentity: token.participantIdentity,
      );
    } catch (error) {
      if (mounted) {
        _updateState(() => _notice = 'LiveKit 监听暂未连接：$error');
      }
    }
  }

  Future<void> _disconnectRoomForTakeover() async {
    await _voiceControl?.stop();
    _roomCallId = null;
    await _roomClient.disconnect();
  }

  void _notifyTerminalTransition(
    String previousStatus,
    AiCallingAgentDraft next,
  ) {
    if (previousStatus == next.status) return;
    final resultReady =
        next.status == 'reconciliation_required' && next.resultSummary != null;
    if (!_isTerminalStatus(next.status) && !resultReady) return;
    if (_isTerminalStatus(next.status) && !_awaitingPhoneCleanup(next)) {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
    final message = resultReady
        ? 'AI 代打已结束，电话正在对账：${next.resultSummary}'
        : switch (next.status) {
            'completed' => 'AI 代打已结束：${next.resultSummary ?? '任务已完成'}',
            'failed' => 'AI 代打已结束：${next.failureReason ?? '任务失败'}',
            'cancelled' => 'AI 代打已取消，电话线路已进入清理流程。',
            _ => 'AI 代打已结束。',
          };
    _notice = message;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(message)));
    });
  }

  bool _isTerminalStatus(String status) {
    return status == 'completed' || status == 'failed' || status == 'cancelled';
  }

  String _roomStatusText(CallRoomConnectionStatus status) {
    return switch (status) {
      CallRoomConnectionStatus.connecting => '连接中',
      CallRoomConnectionStatus.connected => '已连接，正在播放房间通话音频',
      CallRoomConnectionStatus.reconnecting => '重连中',
      CallRoomConnectionStatus.disconnected => '未连接',
    };
  }
}
