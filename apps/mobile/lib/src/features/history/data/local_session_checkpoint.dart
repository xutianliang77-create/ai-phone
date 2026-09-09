part of 'local_session_store.dart';

/// Durable intent only. Neither loading a checkpoint nor acknowledging an
/// operation sends data, starts inference, or authorizes finalization.
enum CheckpointOperationKind { sync, finalize }

class CheckpointOperation {
  const CheckpointOperation(
      {required this.opId, required this.revision, required this.kind});
  final String opId;
  final int revision;
  final CheckpointOperationKind kind;
  Map<String, Object?> toJson() => {
        'opId': opId,
        'revision': revision,
        'kind': kind.name,
      };
}

/// Immutable, explicitly scoped v3 snapshot. It is not a legacy finalize task.
/// Keep the original SessionDetail and subtitle metadata contract inside it.
class LocalSessionCheckpoint {
  LocalSessionCheckpoint._(this.deploymentId, this.ownerId, this.sessionId,
      this.revision, this.tombstone, this._encoded);

  factory LocalSessionCheckpoint(
          {required String deploymentId,
          required String ownerId,
          required int revision,
          required SessionDetail snapshot,
          Map<String, Object?>? lifecycle,
          List<CheckpointOperation> pending = const []}) =>
      LocalSessionCheckpoint.fromJson({
        'deploymentId': deploymentId,
        'ownerId': ownerId,
        'sessionId': snapshot.sessionId,
        'revision': revision,
        'snapshot': _detailToJson(snapshot),
        if (lifecycle != null) 'lifecycle': lifecycle,
        'pending': pending.map((p) => p.toJson()).toList(),
      });

  factory LocalSessionCheckpoint.tombstone(
          {required String deploymentId,
          required String ownerId,
          required String sessionId,
          required int revision,
          required String reason}) =>
      LocalSessionCheckpoint.fromJson({
        'deploymentId': deploymentId,
        'ownerId': ownerId,
        'sessionId': sessionId,
        'revision': revision,
        'tombstone': reason,
        'pending': [],
      });

  factory LocalSessionCheckpoint.fromJson(Object? value) {
    void invalid() => throw const FormatException('Invalid v3 checkpoint');
    if (value is! Map<String, Object?>) invalid();
    final json = value as Map<String, Object?>;
    const fields = {
      'deploymentId',
      'ownerId',
      'sessionId',
      'revision',
      'snapshot',
      'pending',
      'tombstone',
      'lifecycle'
    };
    if (json.keys.any((key) => !fields.contains(key))) invalid();
    if (json['lifecycle'] case final Object lifecycle) {
      if (lifecycle is! Map ||
          lifecycle.keys
              .any((k) => !['modelPolicyRevision', 'ack'].contains(k)) ||
          !_checkpointIdentity(lifecycle['modelPolicyRevision'])) {
        invalid();
      }
    }
    for (final key in ['deploymentId', 'ownerId', 'sessionId']) {
      if (!_checkpointIdentity(json[key])) invalid();
    }
    final revision = json['revision'];
    if (revision is! int || revision < 1) invalid();
    final tombstone = json['tombstone'];
    if (tombstone != null && !['deleted', 'revoked'].contains(tombstone)) {
      invalid();
    }
    final pending = json['pending'];
    if (pending is! List || pending.length > 256) invalid();
    String? status;
    if (tombstone == null) {
      final snapshot = json['snapshot'];
      if (snapshot is! Map<String, Object?>) invalid();
      final detail = SessionDetail.fromJson(snapshot as Map<String, Object?>);
      status = detail.status;
      if (detail.sessionId != json['sessionId'] ||
          !['active', 'paused', 'ending', 'ended'].contains(status) ||
          (status == 'ended') != (detail.endedAt != null) ||
          detail.segmentCount != detail.segments.length ||
          detail.consumedSeconds < 0 ||
          (detail.endedAt?.isBefore(detail.createdAt) ?? false) ||
          detail.segments.length > 20000 ||
          detail.segments.map((s) => s.id).toSet().length !=
              detail.segments.length ||
          detail.segments.any((s) => s.id.trim().isEmpty)) {
        invalid();
      }
    } else if (json.containsKey('snapshot') || (pending as List).isNotEmpty) {
      invalid();
    }
    final ids = <String>{};
    for (final operation in pending as List) {
      if (operation is! Map ||
          operation.length != 3 ||
          !_checkpointIdentity(operation['opId']) ||
          operation['revision'] != revision ||
          !['sync', 'finalize'].contains(operation['kind']) ||
          !ids.add(operation['opId'] as String) ||
          (operation['kind'] == 'finalize' &&
              !['ending', 'ended'].contains(status))) {
        invalid();
      }
    }
    final encoded = _checkpointCanonical(json);
    if (utf8.encode(encoded).length > 8 * 1024 * 1024) invalid();
    return LocalSessionCheckpoint._(
        json['deploymentId'] as String,
        json['ownerId'] as String,
        json['sessionId'] as String,
        revision as int,
        tombstone as String?,
        encoded);
  }

  final String deploymentId, ownerId, sessionId;
  final int revision;
  final String? tombstone;
  final String _encoded;
  // Return detached data: callers cannot mutate an enqueued write or its key.
  Map<String, Object?> toJson() => jsonDecode(_encoded) as Map<String, Object?>;
  SessionDetail? get snapshot => tombstone != null
      ? null
      : SessionDetail.fromJson(toJson()['snapshot'] as Map<String, Object?>);
  List<CheckpointOperation> get pending => (toJson()['pending'] as List)
      .map((p) => CheckpointOperation(
          opId: p['opId'] as String,
          revision: p['revision'] as int,
          kind: CheckpointOperationKind.values.byName(p['kind'] as String)))
      .toList(growable: false);
  String get _key => jsonEncode([deploymentId, ownerId, sessionId]);
}

bool _checkpointIdentity(Object? value) =>
    value is String && value.trim().isNotEmpty && value.length <= 512;

String _checkpointCanonical(Object? value) {
  Object? ordered(Object? current) {
    if (current is Map<String, Object?>) {
      final keys = current.keys.toList()..sort();
      return {for (final key in keys) key: ordered(current[key])};
    }
    if (current is List) return current.map(ordered).toList();
    return current;
  }

  return jsonEncode(ordered(value));
}
