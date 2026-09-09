part of 'realtime_repository.dart';

extension RealtimePublicLifecycle on RealtimeRepository {
  Future<bool> resumeRetainedPublicSession(String sessionId) async {
    if (!_gatewayClient.canResumePublicTransport(sessionId)) return false;
    // This is the original paused connection, not a new handshake. Recheck
    // current server permission; a genuinely lost socket remains unsupported.
    return resumePublicSession(sessionId, reconnect: false);
  }
  int get publicCreationAccountGeneration => _apiClient.accountGeneration;
  Future<PublicCreationResolution?> resolvePendingPublicCreation(
      {String action = 'query', PublicCreationResolution? expected}) {
    if (_disposeRequested || _publicStart != null || _resultSync.session != null) {
      throw StateError('Cannot resolve creation while session is running');
    }
    return _apiClient.resolvePendingPublicCreation(action: action, expected: expected);
  }
  bool get publicLifecycleConfigured =>
      _apiClient.publicDeploymentId.isNotEmpty;
  Future<bool> resumePublicSession(String sessionId,
      {bool reconnect = true}) async {
    final session = _resultSync.session;
    if (session == null ||
        session.sessionId != sessionId ||
        session.syncBinding == null ||
        (reconnect && !session.expiresAt.isAfter(_now()))) {
      return false;
    }
    final epoch = _resultSync.epoch,
        accountEpoch = _apiClient.accountGeneration;
    bool current() =>
        epoch == _resultSync.epoch &&
        accountEpoch == _apiClient.accountGeneration &&
        !_disposeRequested;
    final recovery = await _apiClient.publicLifecycleCall(
        sessionId, session.syncBinding!,
        isCurrent: current);
    if (!current() ||
        recovery['canResume'] != true ||
        recovery['meterStatus'] != 'verified') {
      return false;
    }
    final until = DateTime.tryParse(recovery['recoveryUntil'] as String? ?? '');
    if (until == null || !until.isAfter(_now())) return false;
    final resumed = await (reconnect
        ? _gatewayClient.reconnectAndResume(sessionId)
        : _gatewayClient.resumeAndWait(sessionId));
    return current() && resumed;
  }

  Future<bool> finishPublicSession(
      RealtimeSession session, List<SubtitleSegment> segments,
      {required String mode}) async {
    final binding = session.syncBinding;
    if (binding == null ||
        binding.deploymentId != _apiClient.publicDeploymentId) {
      throw const RealtimeApiException('公有结束身份无效');
    }
    final records = await _resultSyncStore.loadCheckpoints(
        deploymentId: binding.deploymentId, ownerId: binding.ownerId);
    LocalSessionCheckpoint? old;
    for (final row in records) {
      if (row.sessionId == session.sessionId) old = row;
    }
    if (old?.tombstone != null) throw const RealtimeApiException('会话记录已删除');
    if (old?.snapshot?.status == 'ended') return _confirmPublicRecord(old!);
    final revision = (old?.revision ?? 0) + 1;
    final complete = segments.map(SessionSegment.fromSubtitle).toList();
    final record = LocalSessionCheckpoint(
        deploymentId: binding.deploymentId,
        ownerId: binding.ownerId,
        revision: revision,
        snapshot: SessionDetail(
            sessionId: session.sessionId,
            mode: mode,
            status: 'ending',
            consumedSeconds: 0,
            createdAt: old?.snapshot?.createdAt ?? _now(),
            segmentCount: complete.length,
            segments: complete),
        lifecycle: {
          'modelPolicyRevision': binding.modelPolicyRevision
        },
        pending: [
          CheckpointOperation(
              opId: 'finalize:${session.sessionId}',
              revision: revision,
              kind: CheckpointOperationKind.finalize)
        ]);
    await _resultSyncStore.putCheckpoint(record);
    try {
      await _gatewayClient.endAndWait(session.sessionId);
    } catch (_) {}
    await _gatewayClient.close();
    return _confirmPublicRecord(record);
  }

  Future<({int confirmed, int pending})>
      confirmPendingPublicFinalizations() async {
    final account = await _apiClient.publicLifecycleAccount();
    final epoch = _resultSync.epoch,
        accountEpoch = _apiClient.accountGeneration;
    final records = await _resultSyncStore.loadCheckpoints(
        deploymentId: _apiClient.publicDeploymentId, ownerId: account.ownerId!);
    var confirmed = 0, pending = 0;
    for (final row in records) {
      if (!row.pending.any((p) => p.kind == CheckpointOperationKind.finalize) ||
          row.tombstone != null) {
        continue;
      }
      if (epoch != _resultSync.epoch ||
          accountEpoch != _apiClient.accountGeneration) {
        throw const RealtimeApiException('账号或会话已变化');
      }
      try {
        if (await _confirmPublicRecord(row)) {
          confirmed++;
        } else {
          pending++;
        }
      } catch (_) {
        pending++;
      }
    }
    if (epoch != _resultSync.epoch ||
        accountEpoch != _apiClient.accountGeneration) {
      throw const RealtimeApiException('账号或会话已变化');
    }
    return (confirmed: confirmed, pending: pending);
  }

  Future<bool> _confirmPublicRecord(LocalSessionCheckpoint record) async {
    final lifecycle = record.toJson()['lifecycle'];
    if (lifecycle is! Map || lifecycle['modelPolicyRevision'] is! String) {
      return false;
    }
    final binding = ResultSyncBinding(
        deploymentId: record.deploymentId,
        ownerId: record.ownerId,
        modelPolicyRevision: lifecycle['modelPolicyRevision'] as String);
    final epoch = _resultSync.epoch,
        accountEpoch = _apiClient.accountGeneration;
    bool current() =>
        epoch == _resultSync.epoch &&
        accountEpoch == _apiClient.accountGeneration &&
        !_disposeRequested;
    final recovery = await _apiClient
        .publicLifecycleCall(record.sessionId, binding, isCurrent: current);
    if (recovery['canFinalize'] != true ||
        recovery['meterStatus'] != 'verified') {
      return false;
    }
    final watermark = recovery['stopWatermark'];
    if (!_validStopWatermark(watermark)) {
      throw const RealtimeApiException('服务器停止水位缺失');
    }
    final request = <String, Object?>{
      'operation': 'finalize',
      'contractVersion': 1,
      'deploymentId': binding.deploymentId,
      'modelPolicyRevision': binding.modelPolicyRevision,
      'sessionId': record.sessionId,
      'idempotencyKey': 'finalize:${record.sessionId}',
      'stopWatermark': watermark
    };
    final ack = recovery['finalization'] is Map
        ? Map<String, Object?>.from(recovery['finalization'] as Map)
        : await _apiClient.publicLifecycleCall(record.sessionId, binding,
            finalize: request, isCurrent: current);
    if (!current() ||
        ack['operation'] != 'finalize' ||
        ack['contractVersion'] != 1 ||
        ack['status'] != 'ended' ||
        ack['sessionId'] != record.sessionId ||
        ack['ownerId'] != record.ownerId ||
        ack['deploymentId'] != record.deploymentId ||
        ack['modelPolicyRevision'] != binding.modelPolicyRevision ||
        ack['idempotencyKey'] != request['idempotencyKey'] ||
        ack['meterBasis'] != 'server_observed_active_ms' ||
        ack['consumedSeconds'] is! int ||
        (ack['consumedSeconds'] as int) < 0 ||
        (ack['consumedSeconds'] as int) > 86400 ||
        !_sameWatermark(ack['stopWatermark'], watermark)) {
      throw const RealtimeApiException('结束回执不匹配');
    }
    final created = DateTime.tryParse(ack['createdAt'] as String? ?? ''),
        ended = DateTime.tryParse(ack['endedAt'] as String? ?? '');
    if (created == null || ended == null || ended.isBefore(created)) {
      throw const RealtimeApiException('结束时间无效');
    }
    if (record.snapshot?.status == 'ended') {
      return lifecycle['ack'] is Map &&
          record.snapshot!.consumedSeconds == ack['consumedSeconds'] &&
          (lifecycle['ack'] as Map)['idempotencyKey'] ==
              ack['idempotencyKey'] &&
          _sameWatermark((lifecycle['ack'] as Map)['stopWatermark'], watermark);
    }
    final json = record.toJson();
    final snapshot = Map<String, Object?>.from(json['snapshot'] as Map);
    snapshot['status'] = 'ended';
    snapshot['createdAt'] = created.toIso8601String();
    snapshot['endedAt'] = ended.toIso8601String();
    snapshot['consumedSeconds'] = ack['consumedSeconds'];
    json['snapshot'] = snapshot;
    json['pending'] = [];
    json['revision'] = record.revision + 1;
    json['lifecycle'] = {
      'modelPolicyRevision': binding.modelPolicyRevision,
      'ack': ack
    };
    await _resultSyncStore.putAuthorizedCheckpoint(
        LocalSessionCheckpoint.fromJson(json), current);
    return current();
  }
}

bool _validStopWatermark(Object? value) =>
    value is Map &&
    value.length == 4 &&
    value['captureId'] is String &&
    (value['captureId'] as String).isNotEmpty &&
    value['languagePolicyKey'] is String &&
    (value['languagePolicyKey'] as String).isNotEmpty &&
    value['finalRevision'] is int &&
    (value['finalRevision'] as int) >= 0 &&
    value['lastAcceptedSample'] is int &&
    (value['lastAcceptedSample'] as int) >= 0;
bool _sameWatermark(Object? a, Object? b) =>
    _validStopWatermark(a) &&
    _validStopWatermark(b) &&
    (a as Map).keys.every((k) => a[k] == (b as Map)[k]);
