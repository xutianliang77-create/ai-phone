part of 'realtime_repository.dart';

class _ResultSyncState {
  RealtimeSession? session;
  int epoch = 0, accountEpoch = -1;
  String? scopeId;
  DateTime? expiresAt;
  Future<int>? sending;
  bool revocationPending = false;
}

extension RealtimeResultSync on RealtimeRepository {
  String get resultSyncDestination => _apiClient.resultSyncDestination;
  bool get resultSyncRevocationPending => resultSyncAvailable && _resultSync.revocationPending;
  bool get resultSyncAvailable =>
      _resultSync.session?.syncBinding != null &&
      _apiClient.publicDeploymentId ==
          _resultSync.session!.syncBinding!.deploymentId;
  bool get resultSyncEnabled =>
      resultSyncAvailable &&
      _resultSync.scopeId != null &&
      _resultSync.accountEpoch == _apiClient.accountGeneration &&
      (_resultSync.expiresAt?.isAfter(_now()) ?? false);
  void invalidateResultSync({bool retainSession = false}) {
    _resultSync.epoch++;
    _resultSync.scopeId = null;
    _resultSync.expiresAt = null;
    if (!retainSession) { _resultSync.session = null; _resultSync.revocationPending = false; }
  }

  Future<void> setResultSyncConsent(bool allowed) async {
    final session = _resultSync.session;
    if (!resultSyncAvailable || session == null) {
      throw const RealtimeApiException('本会话不支持公有同步');
    }
    if (allowed && _resultSync.revocationPending) throw const RealtimeApiException('请先完成撤销确认');
    if (!allowed) _resultSync.revocationPending = true;
    invalidateResultSync(retainSession: true);
    final epoch = _resultSync.epoch,
        accountEpoch = _apiClient.accountGeneration;
    bool current() =>
        epoch == _resultSync.epoch &&
        accountEpoch == _apiClient.accountGeneration;
    final binding = session.syncBinding!;
    if (!allowed) {
      await _resultSyncStore
          .clearCheckpointSync(
              deploymentId: binding.deploymentId,
              ownerId: binding.ownerId,
              sessionId: session.sessionId)
          .timeout(const Duration(seconds: 2));
    }
    final before = await _apiClient.resultSyncCall(session, {},
        consent: true, isCurrent: current, readConsent: true);
    if (before['deploymentId'] != binding.deploymentId ||
        before['ownerId'] != binding.ownerId ||
        before['modelPolicyRevision'] != binding.modelPolicyRevision ||
        before['consentRevision'] is! int) {
      throw const RealtimeApiException('同步许可版本不匹配');
    }
    final grant = await _apiClient.resultSyncCall(
        session,
        {
          'deploymentId': binding.deploymentId,
          'modelPolicyRevision': binding.modelPolicyRevision,
          'consentVersion': 'result-text-sync-v2',
          'allowed': allowed,
          'expectedRevision': before['consentRevision']
        },
        consent: true,
        isCurrent: current);
    if (!current()) return;
    if (grant['deploymentId'] != binding.deploymentId ||
        grant['ownerId'] != binding.ownerId ||
        grant['modelPolicyRevision'] != binding.modelPolicyRevision ||
        grant['consentVersion'] != 'result-text-sync-v2') {
      throw const RealtimeApiException('同步许可身份不匹配');
    }
    if (allowed) {
      final scope = grant['scopeId'],
          expires = DateTime.tryParse(grant['expiresAt'] as String? ?? '');
      if (scope is! String ||
          scope.isEmpty ||
          grant['revokedAt'] != null ||
          expires == null ||
          !expires.isAfter(_now())) {
        throw const RealtimeApiException('同步许可无效');
      }
      _resultSync.scopeId = scope;
      _resultSync.expiresAt = expires;
      _resultSync.accountEpoch = accountEpoch;
    } else if (grant['revokedAt'] == null) {
      throw const RealtimeApiException('服务器尚未确认撤销');
    } else {
      _resultSync.revocationPending = false;
    }
  }

  Future<int> synchronizeResults(List<SubtitleSegment> segments,
      {required String mode, required int activeSeconds}) {
    if (_resultSync.sending != null) return _resultSync.sending!;
    final task =
        _sendResultSnapshot(segments, mode: mode, activeSeconds: activeSeconds);
    _resultSync.sending = task;
    unawaited(task.then((_) {
      if (identical(_resultSync.sending, task)) _resultSync.sending = null;
    }, onError: (Object _) {
      if (identical(_resultSync.sending, task)) _resultSync.sending = null;
    }));
    return task;
  }

  Future<int> _sendResultSnapshot(List<SubtitleSegment> segments,
      {required String mode, required int activeSeconds}) async {
    if (!resultSyncEnabled) throw const RealtimeApiException('请先允许本会话同步');
    final session = _resultSync.session!,
        binding = session.syncBinding!,
        scope = _resultSync.scopeId!;
    final epoch = _resultSync.epoch,
        accountEpoch = _apiClient.accountGeneration;
    bool current() =>
        epoch == _resultSync.epoch &&
        accountEpoch == _apiClient.accountGeneration &&
        resultSyncEnabled;
    await _apiClient.resultSyncAccount(binding);
    if (!current()) throw const RealtimeApiException('同步已取消');
    final complete = segments
        .where((s) =>
            s.stage == 'translation' &&
            s.revision != null &&
            s.revision! > 0 &&
            s.sourceLanguage != null &&
            s.targetLanguage != null &&
            s.sourceText.trim().isNotEmpty &&
            s.translatedText.trim().isNotEmpty)
        .map(SessionSegment.fromSubtitle)
        .toList();
    if (complete.isEmpty) return 0;
    final existing = await _resultSyncStore.loadCheckpoints(
        deploymentId: binding.deploymentId, ownerId: binding.ownerId);
    LocalSessionCheckpoint? old;
    for (final r in existing) {
      if (r.sessionId == session.sessionId) old = r;
    }
    if (old?.tombstone != null) throw const RealtimeApiException('记录已删除或撤销');
    final revision = (old?.revision ?? 0) + 1;
    final groups = <List<String>>[];
    var group = <String>[], bytes = 1024;
    for (final s in complete) {
      final size = utf8
              .encode(jsonEncode(
                  [s.sourceText, s.translatedText, s.rawText, s.optimizedText]))
              .length +
          512;
      if (group.isNotEmpty &&
          (group.length >= 100 || bytes + size > 240 * 1024)) {
        groups.add(group);
        group = [];
        bytes = 1024;
      }
      group.add(s.id);
      bytes += size;
    }
    if (group.isNotEmpty) groups.add(group);
    var record = LocalSessionCheckpoint(
        deploymentId: binding.deploymentId,
        ownerId: binding.ownerId,
        revision: revision,
        snapshot: SessionDetail(
            sessionId: session.sessionId,
            mode: mode,
            status: 'active',
            consumedSeconds: activeSeconds,
            createdAt: old?.snapshot?.createdAt ?? _now(),
            segmentCount: complete.length,
            segments: complete),
        pending: [
          for (var i = 0; i < groups.length; i++)
            CheckpointOperation(
                opId: '$scope:$revision:$i',
                revision: revision,
                kind: CheckpointOperationKind.sync)
        ]);
    final retry = old != null &&
        old.pending.isNotEmpty &&
        old.pending
            .every((p) => p.opId.startsWith('$scope:${old!.revision}:')) &&
        jsonEncode((old.toJson()['snapshot'] as Map)['segments']) ==
            jsonEncode((record.toJson()['snapshot'] as Map)['segments']);
    if (retry) record = old;
    if (!current()) throw const RealtimeApiException('同步已取消');
    if (!retry &&
        !await _resultSyncStore.putAuthorizedCheckpoint(record, current)) {
      throw const RealtimeApiException('同步已取消');
    }
    var accepted = 0;
    for (final operation in record.pending) {
      final i = int.tryParse(operation.opId.split(':').last);
      if (i == null || i < 0 || i >= groups.length) {
        throw const RealtimeApiException('同步批次身份无效');
      }
      if (!current()) throw const RealtimeApiException('同步已取消，未确认记录已保留');
      final opId = operation.opId;
      final request = resultSyncRequest(record,
          scopeId: scope,
          modelPolicyRevision: binding.modelPolicyRevision,
          opId: opId,
          segmentIds: groups[i]);
      if (utf8.encode(jsonEncode(request)).length > 256 * 1024) {
        throw const RealtimeApiException('单段同步内容过大');
      }
      final ack = await _apiClient.resultSyncCall(session, request,
          consent: false, isCurrent: current);
      if (!current() ||
          !await applyResultSyncAck(_resultSyncStore, record, ack,
              scopeId: scope,
              modelPolicyRevision: binding.modelPolicyRevision,
              opId: opId,
              segmentIds: groups[i],
              isCurrent: current)) {
        throw const RealtimeApiException('同步确认不匹配，待办已保留');
      }
      accepted += groups[i].length;
    }
    return accepted;
  }
}
