import 'dart:convert';
import 'package:crypto/crypto.dart';
import '../../../history/data/local_session_store.dart';

/// Wire-only helpers: they never send HTTP, grant consent, or finalize a session.
Map<String, Object?> resultSyncRequest(
  LocalSessionCheckpoint checkpoint, {
  required String scopeId,
  required String modelPolicyRevision,
  required String opId,
  List<String>? segmentIds,
}) {
  if (checkpoint.deploymentId == deviceLocalDeployment ||
      checkpoint.ownerId == deviceLocalOwner ||
      checkpoint.tombstone != null ||
      scopeId.isEmpty ||
      modelPolicyRevision.isEmpty ||
      !checkpoint.pending.any((p) =>
          p.opId == opId &&
          p.revision == checkpoint.revision &&
          p.kind == CheckpointOperationKind.sync)) {
    throw StateError('Result sync not bound to pending intent');
  }
  final segments = checkpoint.snapshot!.segments
      .where((s) => segmentIds == null || segmentIds.contains(s.id))
      .map((s) => <String, Object?>{
            'id': s.id,
            'revision': s.revision,
            'sourceText': s.sourceText,
            'translatedText': s.translatedText,
            if (s.rawText != null) 'rawText': s.rawText,
            if (s.optimizedText != null) 'optimizedText': s.optimizedText,
            'sourceLanguage': s.sourceLanguage,
            'targetLanguage': s.targetLanguage,
          })
      .toList();
  if (segments.isEmpty ||
      segments.length > 100 ||
      segments.any((s) =>
          s['revision'] is! int ||
          (s['revision'] as int) < 1 ||
          s['sourceLanguage'] == null ||
          s['targetLanguage'] == null)) {
    throw StateError('Invalid result sync segment');
  }
  return {
    'operation': 'sync',
    'sync': {
      'contractVersion': 1,
      'deploymentId': checkpoint.deploymentId,
      'scopeId': scopeId,
      'opId': opId,
      'modelPolicyRevision': modelPolicyRevision,
      'revisions': [
        for (final s in segments)
          {
            'segmentId': s['id'],
            'revision': s['revision'],
            'contentHash': sha256.convert(utf8.encode(_canonical(s))).toString()
          }
      ]
    },
    'segments': segments
  };
}

Future<bool> applyResultSyncAck(
    LocalSessionStore store, LocalSessionCheckpoint checkpoint, Object? ack,
    {required String scopeId,
    required String modelPolicyRevision,
    required String opId,
    List<String>? segmentIds,
    bool Function()? isCurrent}) async {
  final request = resultSyncRequest(checkpoint,
      scopeId: scopeId,
      modelPolicyRevision: modelPolicyRevision,
      opId: opId,
      segmentIds: segmentIds);
  if (ack is! Map ||
      ack.length != 8 ||
      ack['operation'] != 'sync' ||
      ack['sessionId'] != checkpoint.sessionId ||
      ack['deploymentId'] != checkpoint.deploymentId ||
      ack['ownerId'] != checkpoint.ownerId ||
      ack['scopeId'] != scopeId ||
      ack['modelPolicyRevision'] != modelPolicyRevision ||
      ack['opId'] != opId ||
      ack['acceptedRevisions'] is! List) {
    return false;
  }
  final expected =
      ((request['sync'] as Map)['revisions'] as List).map(_canonical).toSet();
  final actual = ack['acceptedRevisions'] as List;
  if (actual.length != expected.length ||
      actual.map(_canonical).toSet().length != actual.length ||
      !actual.every((r) => expected.contains(_canonical(r)))) {
    return false;
  }
  return store.acknowledgeCheckpoint(
      deploymentId: checkpoint.deploymentId,
      ownerId: checkpoint.ownerId,
      sessionId: checkpoint.sessionId,
      opId: opId,
      revision: checkpoint.revision,
      isCurrent: isCurrent);
}

String _canonical(Object? value) {
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return '{${keys.map((k) => '${jsonEncode(k)}:${_canonical(value[k])}').join(',')}}';
  }
  if (value is List) return '[${value.map(_canonical).join(',')}]';
  return jsonEncode(value);
}
