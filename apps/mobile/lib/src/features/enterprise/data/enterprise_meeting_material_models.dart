class EnterpriseMeetingMaterial {
  const EnterpriseMeetingMaterial({
    required this.run,
    required this.segments,
    required this.conclusions,
    required this.actionItems,
  });

  final EnterpriseMeetingMaterialRun run;
  final List<EnterpriseMeetingMaterialSegment> segments;
  final List<EnterpriseMeetingMaterialConclusion> conclusions;
  final List<EnterpriseMeetingMaterialActionItem> actionItems;

  factory EnterpriseMeetingMaterial.fromJson(Map<String, Object?> json) {
    final run = EnterpriseMeetingMaterialRun.fromJson(_map(json, 'run'));
    final segments = _list(json, 'segments')
        .map((value) =>
            EnterpriseMeetingMaterialSegment.fromJson(_object(value)))
        .toList(growable: false);
    final ids = segments.map((segment) => segment.id).toSet();
    if (ids.length != segments.length) {
      throw const FormatException('Duplicate meeting material segment');
    }
    if (run.reviewStatus != 'processing' &&
        run.sourceEventCount != segments.length) {
      throw const FormatException('Meeting material source count mismatch');
    }
    final conclusions = _list(json, 'conclusions')
        .map((value) =>
            EnterpriseMeetingMaterialConclusion.fromJson(_object(value), ids))
        .toList(growable: false);
    final actionItems = _list(json, 'actionItems')
        .map((value) =>
            EnterpriseMeetingMaterialActionItem.fromJson(_object(value), ids))
        .toList(growable: false);
    return EnterpriseMeetingMaterial(
      run: run,
      segments: segments,
      conclusions: conclusions,
      actionItems: actionItems,
    );
  }
}

class EnterpriseMeetingMaterialRun {
  const EnterpriseMeetingMaterialRun({
    required this.id,
    required this.meetingId,
    required this.revision,
    required this.status,
    required this.sourceEventCount,
    required this.reviewStatus,
    required this.createdAt,
    required this.updatedAt,
    required this.version,
    this.reviewReasonCode,
    this.retentionUntil,
    this.publishedAt,
  });

  final String id;
  final String meetingId;
  final int revision;
  final String status;
  final int sourceEventCount;
  final String reviewStatus;
  final String? reviewReasonCode;
  final DateTime? retentionUntil;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? publishedAt;
  final int version;

  factory EnterpriseMeetingMaterialRun.fromJson(Map<String, Object?> json) {
    final id = _text(json, 'id');
    final meetingId = _text(json, 'meetingId');
    final revision = _integer(json, 'revision', minimum: 1);
    final status = _text(json, 'status');
    final sourceEventCount = _integer(json, 'sourceEventCount');
    final sourceHash = _text(json, 'sourceHash');
    final reviewStatus = _text(json, 'reviewStatus');
    final reason = _optionalText(json, 'reviewReasonCode');
    final publishedAt = _optionalTime(json, 'publishedAt');
    if (!_uuid(id) ||
        !_uuid(meetingId) ||
        !const {'draft', 'published'}.contains(status) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(sourceHash) ||
        !const {'processing', 'not_configured', 'ready', 'failed'}
            .contains(reviewStatus) ||
        (reviewStatus == 'ready') != (reason == null) ||
        (status == 'published') != (publishedAt != null)) {
      throw const FormatException('Invalid meeting material run');
    }
    return EnterpriseMeetingMaterialRun(
      id: id,
      meetingId: meetingId,
      revision: revision,
      status: status,
      sourceEventCount: sourceEventCount,
      reviewStatus: reviewStatus,
      reviewReasonCode: reason,
      retentionUntil: _optionalTime(json, 'retentionUntil'),
      createdAt: _time(json, 'createdAt'),
      updatedAt: _time(json, 'updatedAt'),
      publishedAt: publishedAt,
      version: _integer(json, 'version', minimum: 1),
    );
  }
}

class EnterpriseMeetingMaterialSegment {
  const EnterpriseMeetingMaterialSegment({
    required this.id,
    required this.ordinal,
    required this.sourceParticipantId,
    required this.speakerLabel,
    required this.sourceLanguage,
    required this.sourceText,
    required this.translations,
    required this.occurredAt,
  });

  final String id;
  final int ordinal;
  final String sourceParticipantId;
  final String speakerLabel;
  final String sourceLanguage;
  final String sourceText;
  final List<EnterpriseMeetingMaterialTranslation> translations;
  final DateTime occurredAt;

  factory EnterpriseMeetingMaterialSegment.fromJson(Map<String, Object?> json) {
    final id = _text(json, 'id');
    final participantId = _text(json, 'sourceParticipantId');
    final language = _text(json, 'sourceLanguage');
    _bounded(json, 'sourceTrackSid', 128);
    _bounded(json, 'sourceSegmentId', 160);
    _integer(json, 'revision');
    if (!_uuid(id) ||
        !_uuid(participantId) ||
        !const {'zh', 'en'}.contains(language)) {
      throw const FormatException('Invalid meeting material segment');
    }
    return EnterpriseMeetingMaterialSegment(
      id: id,
      ordinal: _integer(json, 'ordinal'),
      sourceParticipantId: participantId,
      speakerLabel: _bounded(json, 'speakerLabel', 120),
      sourceLanguage: language,
      sourceText: _bounded(json, 'sourceText', 32768),
      translations: _list(json, 'translations')
          .map((value) =>
              EnterpriseMeetingMaterialTranslation.fromJson(_object(value)))
          .toList(growable: false),
      occurredAt: _time(json, 'occurredAt'),
    );
  }
}

class EnterpriseMeetingMaterialTranslation {
  const EnterpriseMeetingMaterialTranslation({
    required this.language,
    required this.text,
  });
  final String language;
  final String text;

  factory EnterpriseMeetingMaterialTranslation.fromJson(
    Map<String, Object?> json,
  ) {
    final language = _text(json, 'language');
    if (!const {'zh', 'en'}.contains(language)) {
      throw const FormatException('Invalid meeting material translation');
    }
    return EnterpriseMeetingMaterialTranslation(
      language: language,
      text: _bounded(json, 'text', 32768),
    );
  }
}

class EnterpriseMeetingMaterialConclusion {
  const EnterpriseMeetingMaterialConclusion({
    required this.id,
    required this.kind,
    required this.text,
    required this.evidenceSegmentIds,
  });
  final String id;
  final String kind;
  final String text;
  final List<String> evidenceSegmentIds;

  factory EnterpriseMeetingMaterialConclusion.fromJson(
    Map<String, Object?> json,
    Set<String> segmentIds,
  ) {
    final id = _text(json, 'id');
    final kind = _text(json, 'kind');
    _integer(json, 'ordinal');
    final evidence = _evidence(json, segmentIds);
    if (!_uuid(id) ||
        !const {
          'summary',
          'topic',
          'decision',
          'objection',
          'risk',
          'unresolved',
        }.contains(kind)) {
      throw const FormatException('Invalid meeting material conclusion');
    }
    return EnterpriseMeetingMaterialConclusion(
      id: id,
      kind: kind,
      text: _bounded(json, 'text', 2000),
      evidenceSegmentIds: evidence,
    );
  }
}

class EnterpriseMeetingMaterialActionItem {
  const EnterpriseMeetingMaterialActionItem({
    required this.id,
    required this.text,
    required this.status,
    required this.evidenceSegmentIds,
    required this.version,
    this.ownerParticipantId,
    this.dueAt,
    this.priority,
  });
  final String id;
  final String text;
  final String status;
  final List<String> evidenceSegmentIds;
  final int version;
  final String? ownerParticipantId;
  final DateTime? dueAt;
  final String? priority;

  factory EnterpriseMeetingMaterialActionItem.fromJson(
    Map<String, Object?> json,
    Set<String> segmentIds,
  ) {
    final id = _text(json, 'id');
    final status = _text(json, 'status');
    final owner = _optionalText(json, 'ownerParticipantId');
    final priority = _optionalText(json, 'priority');
    _integer(json, 'ordinal');
    if (!_uuid(id) ||
        owner != null && !_uuid(owner) ||
        !const {'open', 'completed', 'cancelled'}.contains(status) ||
        priority != null &&
            !const {'low', 'medium', 'high'}.contains(priority)) {
      throw const FormatException('Invalid meeting material action');
    }
    return EnterpriseMeetingMaterialActionItem(
      id: id,
      text: _bounded(json, 'text', 2000),
      status: status,
      evidenceSegmentIds: _evidence(json, segmentIds),
      version: _integer(json, 'version', minimum: 1),
      ownerParticipantId: owner,
      dueAt: _optionalTime(json, 'dueAt'),
      priority: priority,
    );
  }
}

List<String> _evidence(Map<String, Object?> json, Set<String> segmentIds) {
  final values = _list(json, 'evidenceSegmentIds');
  final ids = values.whereType<String>().toList(growable: false);
  if (ids.length != values.length ||
      ids.isEmpty ||
      ids.length > 20 ||
      ids.any((id) => !segmentIds.contains(id))) {
    throw const FormatException('Invalid meeting material evidence');
  }
  return ids;
}

Map<String, Object?> _map(Map<String, Object?> json, String key) =>
    _object(json[key]);
Map<String, Object?> _object(Object? value) {
  if (value is! Map<String, Object?>) {
    throw const FormatException('Invalid meeting material object');
  }
  return value;
}

List<Object?> _list(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! List<Object?>) {
    throw const FormatException('Invalid meeting material list');
  }
  return value;
}

String _text(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw const FormatException('Invalid meeting material text');
  }
  return value;
}

String _bounded(Map<String, Object?> json, String key, int maximum) {
  final value = _text(json, key);
  if (value.length > maximum) {
    throw const FormatException('Meeting material text too long');
  }
  return value;
}

String? _optionalText(Map<String, Object?> json, String key) {
  final value = json[key];
  return value == null
      ? null
      : value is String && value.trim().isNotEmpty
          ? value
          : throw const FormatException(
              'Invalid optional meeting material text');
}

int _integer(Map<String, Object?> json, String key, {int minimum = 0}) {
  final value = json[key];
  if (value is! int || value < minimum) {
    throw const FormatException('Invalid material number');
  }
  return value;
}

DateTime _time(Map<String, Object?> json, String key) =>
    DateTime.parse(_text(json, key));
DateTime? _optionalTime(Map<String, Object?> json, String key) {
  final value = json[key];
  return value == null
      ? null
      : value is String
          ? DateTime.parse(value)
          : throw const FormatException('Invalid meeting material time');
}

bool _uuid(String value) => RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(value);
