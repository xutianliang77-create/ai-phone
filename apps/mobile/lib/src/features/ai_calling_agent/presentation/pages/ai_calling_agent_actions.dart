part of 'ai_calling_agent_page.dart';

extension _AiCallingAgentActions on _AiCallingAgentPageState {
  Future<void> _createDraft() async {
    final objective = _objectiveController.text.trim();
    final targetPhone = _targetPhoneController.text.trim();
    if (objective.isEmpty) {
      _updateState(() => _error = '请先填写本次电话目标');
      return;
    }
    if (targetPhone.isNotEmpty && !isValidAgentCallPhone(targetPhone)) {
      _updateState(() => _error = '请输入有效电话号码');
      return;
    }
    await _run(() async {
      final draft = await _client.createDraft(
        scenario: _scenario,
        objective: objective,
        targetName: _targetNameController.text.trim(),
        targetPhone: targetPhone,
      );
      _setDraft(draft);
      _notice =
          draft.requiresHumanTakeover ? '已识别高风险内容，请人工接管。' : '话术草稿已生成，请确认授权。';
    });
  }

  Future<void> _authorizeDraft() async {
    final draft = _draft;
    if (draft == null || !await _ensureVoiceConsent()) return;
    if (!_recipientDisclosureConfirmed) {
      _updateState(() => _error = '请先确认接通后向对方告知 AI 身份');
      return;
    }
    if (!mounted) return;
    await _run(() async {
      final next = await _client.authorizeDraft(
        draftId: draft.id,
        consentPromptVersion: _consentPromptVersion,
        recipientDisclosureConfirmed: true,
        disclosurePromptVersion: _disclosurePromptVersion,
      );
      _setDraft(next);
      _notice =
          next.requiresHumanTakeover ? '风险内容需要人工接管，暂不自动外呼。' : '已授权，可开始执行。';
    });
  }

  Future<void> _startDraft() async {
    final draft = _draft;
    if (draft == null || !await _ensureVoiceConsent() || !mounted) return;
    await _run(() async {
      _setDraft(await _client.startDraft(
        draftId: draft.id,
        consentPromptVersion: _consentPromptVersion,
      ));
      _notice = '已进入执行队列，通话接通后 App 会自动接收 LiveKit 双向译音。';
    });
  }

  Future<void> _refreshDraft() => _fetchDraft(showNotice: true);

  Future<void> _fetchDraft({required bool showNotice}) async {
    final draft = _draft;
    if (draft == null) return;
    final previousStatus = draft.status;
    try {
      final next = await _client.getDraft(draftId: draft.id);
      if (!mounted) return;
      _updateState(() {
        _setDraft(next);
        if (showNotice) _notice = '状态已刷新。';
      });
      _notifyTerminalTransition(previousStatus, next);
    } catch (error) {
      if (mounted && showNotice) {
        _updateState(() => _error = error);
      }
    }
  }

  Future<void> _requestTakeover() async {
    final draft = _draft;
    if (draft == null || !await _ensureVoiceConsent()) return;
    await _disconnectRoomForTakeover();
    if (draft.status != 'takeover_requested') {
      await _run(() async {
        _setDraft(await _client.requestTakeover(
          draftId: draft.id,
          reason: 'user_requested_takeover',
        ));
        _notice = '已记录人工接管请求。';
      });
    }
    final takeover = _draft;
    final callId = takeover?.callId;
    if (!mounted ||
        takeover == null ||
        callId == null ||
        takeover.status != 'takeover_requested') {
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => AgentCallTakeoverPage(
        draftId: takeover.id,
        callId: callId,
        takeoverReadyAt: takeover.takeoverReadyAt,
      ),
    ));
    if (!mounted) return;
    await _refreshDraft();
    final current = _draft;
    if (current != null) unawaited(_syncDraftLifecycle(current));
  }

  Future<void> _pauseAgent() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _setDraft(await _client.pauseDraft(draftId: draft.id));
      _notice = 'AI 已暂停；电话保持接通，当前 TTS 已清空。';
    });
  }

  Future<void> _resumeAgent() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _setDraft(await _client.resumeDraft(draftId: draft.id));
      _notice = 'AI 已在同一通电话内恢复监听和发言。';
    });
  }

  Future<void> _cancelDraft() async {
    final draft = _draft;
    if (draft == null) return;
    await _run(() async {
      _setDraft(await _client.cancelDraft(draftId: draft.id));
      _notice = switch (_client.lastCancellation?.status) {
        'accepted' => '已取消任务，已向同一通话发送挂断请求。请刷新确认电话网络已结束。',
        'requested' => '已取消任务，已请求通话运行时挂断。请刷新确认电话网络已结束。',
        'unknown' => '已取消任务，但挂断结果待对账；请勿重新拨号。',
        'failed' => '已取消任务，但挂断未下发；如电话仍在通话，请点击“重试挂断”。',
        _ => '已取消任务，未发起拨号。',
      };
    });
  }
}
