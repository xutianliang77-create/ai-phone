part of 'local_session_store.dart';

// Reuse v1.0 outbox's same-isolate serialization + temporary-file rename pattern,
// adding flush and a separate namespace. Never read or rewrite the old outbox.
final _checkpointWrites = <String, Future<void>>{};

extension LocalSessionCheckpointStorage on LocalSessionStore {
  Future<List<LocalSessionCheckpoint>> loadCheckpoints(
      {required String deploymentId, required String ownerId}) async {
    if (!_checkpointIdentity(deploymentId) || !_checkpointIdentity(ownerId)) {
      throw ArgumentError('Checkpoint scope is required');
    }
    final file = await _checkpointFile();
    return _serializeCheckpoint(
        file,
        () async => (await _readCheckpoints(file))
            .where(
                (r) => r.deploymentId == deploymentId && r.ownerId == ownerId)
            .toList(growable: false));
  }

  Future<bool> putAuthorizedCheckpoint(
          LocalSessionCheckpoint record, bool Function() isCurrent) =>
      _putCheckpoint(record, isCurrent: isCurrent);

  Future<bool> _putCheckpoint(LocalSessionCheckpoint record,
      {bool Function()? isCurrent}) async {
    final file = await _checkpointFile();
    return _serializeCheckpoint(file, () async {
      final records = await _readCheckpoints(file);
      final index = records.indexWhere((r) => r._key == record._key);
      if (isCurrent?.call() == false) return false;
      if (index >= 0) {
        final old = records[index];
        if (old.revision == record.revision &&
            old._encoded == record._encoded) {
          return false;
        }
        if (record.revision <= old.revision) {
          throw StateError(
              'Checkpoint stale revision or same-version conflict');
        }
        if (old.tombstone != null ||
            (old.snapshot?.status == 'ended' && record.tombstone == null)) {
          throw StateError('Checkpoint terminal state cannot be reopened');
        }
        records[index] = record;
      } else {
        records.add(record);
      }
      await _writeCheckpoints(file, records, isCurrent: isCurrent);
      return true;
    });
  }

  /// Only a caller that verified the server's scope may apply its ACK here.
  /// A different snapshot revision never removes a newer pending operation.
  Future<bool> acknowledgeCheckpoint(
      {required String deploymentId,
      required String ownerId,
      required String sessionId,
      required String opId,
      required int revision,
      bool Function()? isCurrent}) async {
    final file = await _checkpointFile();
    return _serializeCheckpoint(file, () async {
      final records = await _readCheckpoints(file);
      final index = records.indexWhere((r) =>
          r.deploymentId == deploymentId &&
          r.ownerId == ownerId &&
          r.sessionId == sessionId);
      if (index < 0 || isCurrent?.call() == false) return false;
      final record = records[index];
      if (record.tombstone != null ||
          record.revision != revision ||
          !record.pending
              .any((p) => p.opId == opId && p.revision == revision)) {
        return false;
      }
      final json = record.toJson();
      json['pending'] = record.pending
          .where((p) => p.opId != opId)
          .map((p) => p.toJson())
          .toList();
      records[index] = LocalSessionCheckpoint.fromJson(json);
      await _writeCheckpoints(file, records, isCurrent: isCurrent);
      return true;
    });
  }

  Future<File> _checkpointFile() async {
    // A file override remains isolated beside that file (including tests).
    if (_file != null) return File('${_file.path}.checkpoints-v3.json');
    final directory = await getApplicationDocumentsDirectory();
    return File('${directory.path}/realtime-session-checkpoints-v3.json');
  }

  Future<void> clearCheckpointSync(
      {required String deploymentId,
      required String ownerId,
      required String sessionId}) async {
    final file = await _checkpointFile();
    await _serializeCheckpoint(file, () async {
      final records = await _readCheckpoints(file);
      final index = records.indexWhere((r) =>
          r.deploymentId == deploymentId &&
          r.ownerId == ownerId &&
          r.sessionId == sessionId);
      if (index < 0 || records[index].tombstone != null) return;
      final json = records[index].toJson();
      json['pending'] = records[index].pending.where((p)=>p.kind!=CheckpointOperationKind.sync)
          .map((p)=>CheckpointOperation(opId:p.opId,revision:records[index].revision+1,kind:p.kind).toJson()).toList();
      json['revision'] = records[index].revision + 1;
      records[index] = LocalSessionCheckpoint.fromJson(json);
      await _writeCheckpoints(file, records);
    });
  }

  Future<List<LocalSessionCheckpoint>> _readCheckpoints(File file) async {
    if (!await file.exists()) return [];
    if (await file.length() > 32 * 1024 * 1024) {
      throw const FormatException('Checkpoint file exceeds limit');
    }
    final json = jsonDecode(await file.readAsString());
    if (json is! Map ||
        json['version'] != 3 ||
        json['records'] is! List ||
        json.length != 2 ||
        (json['records'] as List).length > 1024) {
      throw const FormatException('Invalid v3 checkpoint file; preserved');
    }
    final records =
        (json['records'] as List).map(LocalSessionCheckpoint.fromJson).toList();
    if (records.map((r) => r._key).toSet().length != records.length) {
      throw const FormatException('Duplicate checkpoint scope');
    }
    return records;
  }

  Future<void> _writeCheckpoints(
      File file, List<LocalSessionCheckpoint> records,
      {bool Function()? isCurrent}) async {
    final encoded = jsonEncode(
        {'version': 3, 'records': records.map((r) => r.toJson()).toList()});
    if (records.length > 1024 ||
        utf8.encode(encoded).length > 32 * 1024 * 1024) {
      throw StateError('Checkpoint capacity exceeded');
    }
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(encoded, flush: true);
    await _checkpointBeforeReplace?.call();
    if (isCurrent?.call() == false) {
      throw StateError('Checkpoint authorization invalidated');
    }
    await temporary.rename(file.path);
  }

  Future<T> _serializeCheckpoint<T>(
      File file, Future<T> Function() action) async {
    final key = file.absolute.uri.normalizePath().toFilePath();
    final previous = _checkpointWrites[key] ?? Future<void>.value();
    final complete = Completer<void>();
    _checkpointWrites[key] = complete.future;
    await previous.catchError((Object _) {});
    try {
      return await action();
    } finally {
      complete.complete();
      if (identical(_checkpointWrites[key], complete.future)) {
        _checkpointWrites.remove(key);
      }
    }
  }
}
