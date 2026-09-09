part of 'local_session_store.dart';

// Device-local history is deliberately independent of any current cloud login.
// These records have no server session or upload consent and no pending ops.
const deviceLocalDeployment = 'device-local';
const deviceLocalOwner = 'device-local';

extension LocalCheckpointHistory on LocalSessionStore {
  Future<List<SessionDetail>> _loadSessions() async {
    final legacy = await _loadLegacySessions();
    final checkpoints = await loadCheckpoints(
        deploymentId: deviceLocalDeployment, ownerId: deviceLocalOwner);
    final ids = checkpoints.map((c) => c.sessionId).toSet();
    final records = <SessionDetail>[
      for (final c in checkpoints)
        if (c.tombstone == null) _checkpointHistoryDetail(c),
      ...legacy.where((s) => !ids.contains(s.sessionId)),
    ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return records;
  }

  Future<SessionDetail?> _editCheckpointHistory(
      String sessionId, SessionDetail Function(SessionDetail) edit) async {
    final file = await _checkpointFile();
    return _serializeCheckpoint(file, () async {
      final records = await _readCheckpoints(file);
      final index = records.indexWhere((r) =>
          r.sessionId == sessionId &&
          r.deploymentId == deviceLocalDeployment &&
          r.ownerId == deviceLocalOwner);
      if (index < 0) return null;
      final old = records[index];
      if (old.tombstone != null) throw LocalSessionNotFoundException(sessionId);
      // Editing a live snapshot could race with capture revisions. Require
      // normal end first; viewing/exporting its saved contents remains allowed.
      if (old.snapshot!.status != 'ended') {
        throw StateError('未结束的快照仅可查看、导出或删除');
      }
      final detail = edit(old.snapshot!);
      records[index] = LocalSessionCheckpoint(
          deploymentId: deviceLocalDeployment,
          ownerId: deviceLocalOwner,
          revision: old.revision + 1,
          snapshot: detail);
      await _writeCheckpoints(file, records);
      return detail;
    });
  }

  Future<bool> _deleteCheckpointHistory(String sessionId) async {
    final file = await _checkpointFile();
    return _serializeCheckpoint(file, () async {
      final records = await _readCheckpoints(file);
      final index = records.indexWhere((r) =>
          r.sessionId == sessionId &&
          r.deploymentId == deviceLocalDeployment &&
          r.ownerId == deviceLocalOwner);
      if (index < 0) return false;
      final old = records[index];
      if (old.tombstone != null) return true;
      records[index] = LocalSessionCheckpoint.tombstone(
          deploymentId: deviceLocalDeployment,
          ownerId: deviceLocalOwner,
          sessionId: sessionId,
          revision: old.revision + 1,
          reason: 'deleted');
      await _writeCheckpoints(file, records);
      return true;
    });
  }
}

SessionDetail _checkpointHistoryDetail(LocalSessionCheckpoint record) {
  final json = record.toJson()['snapshot'] as Map<String, Object?>;
  if (json['status'] != 'ended') json['status'] = 'checkpoint';
  return SessionDetail.fromJson(json);
}
