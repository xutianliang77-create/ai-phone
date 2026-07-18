class EnterpriseMobileMeeting {
  const EnterpriseMobileMeeting({
    required this.id,
    required this.title,
    required this.status,
    required this.allowGuests,
    required this.createdAt,
    this.scheduledAt,
  });

  final String id;
  final String title;
  final String status;
  final bool allowGuests;
  final DateTime createdAt;
  final DateTime? scheduledAt;

  factory EnterpriseMobileMeeting.fromJson(Map<String, Object?> json) {
    final policy = _map(json, 'policy');
    final allowGuests = policy['allowGuests'];
    if (allowGuests is! bool) {
      throw const FormatException('Invalid enterprise meeting policy');
    }
    return EnterpriseMobileMeeting(
      id: _text(json, 'id'),
      title: _text(json, 'title'),
      status: _text(json, 'status'),
      allowGuests: allowGuests,
      createdAt: DateTime.parse(_text(json, 'createdAt')),
      scheduledAt: _optionalTime(json, 'scheduledAt'),
    );
  }
}

class EnterpriseMobileMeetingAggregate {
  const EnterpriseMobileMeetingAggregate({
    required this.meeting,
    required this.participantCount,
    this.communicationStatus,
  });

  final EnterpriseMobileMeeting meeting;
  final int participantCount;
  final String? communicationStatus;

  factory EnterpriseMobileMeetingAggregate.fromJson(
    Map<String, Object?> json,
  ) {
    final participants = json['participants'];
    if (participants is! List<Object?>) {
      throw const FormatException('Invalid enterprise meeting participants');
    }
    final communication = json['communication'];
    return EnterpriseMobileMeetingAggregate(
      meeting: EnterpriseMobileMeeting.fromJson(_map(json, 'meeting')),
      participantCount: participants.length,
      communicationStatus: communication is Map<String, Object?>
          ? _optionalText(communication, 'status')
          : null,
    );
  }
}

class EnterpriseMobileMeetingJoinGrant {
  const EnterpriseMobileMeetingJoinGrant({
    required this.meetingId,
    required this.participantRole,
    required this.rtcUrl,
    required this.accessToken,
    required this.expiresAt,
  });

  final String meetingId;
  final String participantRole;
  final Uri rtcUrl;
  final String accessToken;
  final DateTime expiresAt;

  factory EnterpriseMobileMeetingJoinGrant.fromJson(
    Map<String, Object?> json,
  ) {
    final capabilities = _map(json, 'capabilities');
    final validCapabilities = capabilities['microphone'] == true &&
        capabilities['subscribe'] == true &&
        capabilities['camera'] == false &&
        capabilities['data'] == false &&
        capabilities['screenShare'] == false;
    final provider = _text(json, 'provider');
    final rtcUrl = Uri.parse(_text(json, 'rtcUrl'));
    final expiresAt = DateTime.parse(_text(json, 'expiresAt'));
    if (provider != 'livekit' ||
        rtcUrl.scheme != 'wss' ||
        !validCapabilities ||
        !expiresAt.isAfter(DateTime.now())) {
      throw const FormatException('Invalid enterprise meeting grant');
    }
    return EnterpriseMobileMeetingJoinGrant(
      meetingId: _text(json, 'meetingId'),
      participantRole: _text(json, 'participantRole'),
      rtcUrl: rtcUrl,
      accessToken: _text(json, 'accessToken'),
      expiresAt: expiresAt,
    );
  }
}

Map<String, Object?> _map(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map<String, Object?>) {
    throw FormatException('Invalid enterprise meeting $key');
  }
  return value;
}

String _text(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid enterprise meeting $key');
  }
  return value;
}

String? _optionalText(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  return value is String && value.trim().isNotEmpty ? value : null;
}

DateTime? _optionalTime(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String) {
    throw FormatException('Invalid enterprise meeting $key');
  }
  return DateTime.parse(value);
}
