class RealtimeFinalizationTask {
  const RealtimeFinalizationTask({
    required this.sessionId,
    required this.idempotencyKey,
    required this.segments,
    required this.billableSeconds,
    required this.createdAt,
  });

  final String sessionId;
  final String idempotencyKey;
  final List<Map<String, Object?>> segments;
  final int billableSeconds;
  final DateTime createdAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'sessionId': sessionId,
        'idempotencyKey': idempotencyKey,
        'segments': segments,
        'billableSeconds': billableSeconds,
        'createdAt': createdAt.toUtc().toIso8601String(),
      };

  static RealtimeFinalizationTask? fromJson(Object? value) {
    if (value is! Map) return null;
    final json = Map<String, Object?>.from(value);
    final sessionId = json['sessionId'];
    final idempotencyKey = json['idempotencyKey'];
    final segments = json['segments'];
    final billableSeconds = json['billableSeconds'];
    final createdAt = DateTime.tryParse(json['createdAt'] as String? ?? '');
    if (sessionId is! String ||
        idempotencyKey is! String ||
        segments is! List ||
        billableSeconds is! num ||
        createdAt == null) {
      return null;
    }
    return RealtimeFinalizationTask(
      sessionId: sessionId,
      idempotencyKey: idempotencyKey,
      segments: segments
          .whereType<Map>()
          .map((item) => Map<String, Object?>.from(item))
          .toList(growable: false),
      billableSeconds:
          billableSeconds.toInt() < 0 ? 0 : billableSeconds.toInt(),
      createdAt: createdAt,
    );
  }
}

class RealtimeFinalizationQuarantineRecord {
  const RealtimeFinalizationQuarantineRecord({
    required this.task,
    required this.reason,
    required this.quarantinedAt,
  });

  final RealtimeFinalizationTask task;
  final String reason;
  final DateTime quarantinedAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'task': task.toJson(),
        'reason': reason,
        'quarantinedAt': quarantinedAt.toUtc().toIso8601String(),
      };

  static RealtimeFinalizationQuarantineRecord? fromJson(Object? value) {
    if (value is! Map) return null;
    final json = Map<String, Object?>.from(value);
    final task = RealtimeFinalizationTask.fromJson(json['task']);
    final reason = json['reason'];
    final quarantinedAt =
        DateTime.tryParse(json['quarantinedAt'] as String? ?? '');
    if (task == null ||
        reason is! String ||
        reason.isEmpty ||
        quarantinedAt == null) {
      return null;
    }
    return RealtimeFinalizationQuarantineRecord(
      task: task,
      reason: reason,
      quarantinedAt: quarantinedAt,
    );
  }
}
