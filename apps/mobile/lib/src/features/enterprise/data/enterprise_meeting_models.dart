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
    required this.communicationSessionId,
    required this.participantId,
    required this.participantRole,
    required this.roomName,
    required this.rtcUrl,
    required this.accessToken,
    required this.expiresAt,
    required this.translation,
  });

  final String meetingId;
  final String communicationSessionId;
  final String participantId;
  final String participantRole;
  final String roomName;
  final Uri rtcUrl;
  final String accessToken;
  final DateTime expiresAt;
  final EnterpriseMobileMeetingTranslationGrant translation;

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
    final meetingId = _text(json, 'meetingId');
    final communicationSessionId = _text(json, 'communicationSessionId');
    final participantId = _text(json, 'participantId');
    final participantRole = _text(json, 'participantRole');
    final roomName = _text(json, 'roomName');
    if (provider != 'livekit' ||
        rtcUrl.scheme != 'wss' ||
        !_uuid(meetingId) ||
        !_uuid(communicationSessionId) ||
        !_uuid(participantId) ||
        !const <String>{'host', 'member', 'guest'}.contains(participantRole) ||
        !RegExp(r'^ent_[a-f0-9]{32}$').hasMatch(roomName) ||
        !validCapabilities ||
        !expiresAt.isAfter(DateTime.now())) {
      throw const FormatException('Invalid enterprise meeting grant');
    }
    return EnterpriseMobileMeetingJoinGrant(
      meetingId: meetingId,
      communicationSessionId: communicationSessionId,
      participantId: participantId,
      participantRole: participantRole,
      roomName: roomName,
      rtcUrl: rtcUrl,
      accessToken: _text(json, 'accessToken'),
      expiresAt: expiresAt,
      translation: EnterpriseMobileMeetingTranslationGrant.fromJson(
        _map(json, 'translation'),
      ),
    );
  }
}

class EnterpriseMobileMeetingTranslationGrant {
  const EnterpriseMobileMeetingTranslationGrant({
    required this.status,
    required this.reasonCode,
    required this.topic,
    required this.generation,
    required this.captionLanguage,
    required this.translatedAudioEnabled,
    required this.translatedAudioAvailable,
    required this.playbackGeneration,
  });

  final String status;
  final String reasonCode;
  final String topic;
  final int generation;
  final String captionLanguage;
  final bool translatedAudioEnabled;
  final bool translatedAudioAvailable;
  final int playbackGeneration;

  factory EnterpriseMobileMeetingTranslationGrant.fromJson(
    Map<String, Object?> json,
  ) {
    final status = _text(json, 'status');
    final reasonCode = _text(json, 'reasonCode');
    final topic = _text(json, 'topic');
    final generation = json['generation'];
    final captionLanguage = _text(json, 'captionLanguage');
    final translatedAudioEnabled = json['translatedAudioEnabled'];
    final translatedAudioAvailable = json['translatedAudioAvailable'];
    final playbackGeneration = json['playbackGeneration'];
    if (!const <String>{'ready', 'captions_only', 'not_ready'}
            .contains(status) ||
        topic != 'wujie.enterprise.meeting.translation.v1' ||
        generation is! int ||
        generation < 1 ||
        !const <String>{'zh', 'en'}.contains(captionLanguage) ||
        translatedAudioEnabled is! bool ||
        translatedAudioAvailable != false ||
        playbackGeneration is! int ||
        playbackGeneration < 1 ||
        reasonCode.length > 160) {
      throw const FormatException(
          'Invalid enterprise meeting translation grant');
    }
    return EnterpriseMobileMeetingTranslationGrant(
      status: status,
      reasonCode: reasonCode,
      topic: topic,
      generation: generation,
      captionLanguage: captionLanguage,
      translatedAudioEnabled: translatedAudioEnabled,
      translatedAudioAvailable: translatedAudioAvailable as bool,
      playbackGeneration: playbackGeneration,
    );
  }
}

class EnterpriseMobileMeetingCaption {
  const EnterpriseMobileMeetingCaption({
    required this.eventId,
    required this.type,
    required this.sourceDisplayName,
    required this.text,
    required this.language,
    required this.occurredAt,
  });

  final String eventId;
  final String type;
  final String sourceDisplayName;
  final String text;
  final String language;
  final DateTime occurredAt;

  factory EnterpriseMobileMeetingCaption.fromJson(
    Map<String, Object?> json,
    EnterpriseMobileMeetingJoinGrant grant,
  ) {
    final eventId = _text(json, 'eventId');
    final type = _text(json, 'type');
    final sourceLanguage = _text(json, 'sourceLanguage');
    final targetLanguage = _text(json, 'targetLanguage');
    final translatedAudio = _map(json, 'translatedAudio');
    final expectedLanguage =
        type == 'transcript.final' ? sourceLanguage : targetLanguage;
    if (json['v'] != 1 ||
        !_uuid(eventId) ||
        !const <String>{'transcript.final', 'translation.final'}
            .contains(type) ||
        json['meetingId'] != grant.meetingId ||
        json['communicationSessionId'] != grant.communicationSessionId ||
        json['targetParticipantId'] != grant.participantId ||
        json['generation'] != grant.translation.generation ||
        expectedLanguage != grant.translation.captionLanguage ||
        !_uuid(json['sourceParticipantId']) ||
        !_bounded(json['sourceDisplayName'], 120) ||
        !_bounded(json['sourceTrackSid'], 128) ||
        !_bounded(json['segmentId'], 160) ||
        json['revision'] is! int ||
        (json['revision'] as int) < 0 ||
        !const <String>{'zh', 'en'}.contains(sourceLanguage) ||
        !const <String>{'zh', 'en'}.contains(targetLanguage) ||
        sourceLanguage == targetLanguage ||
        !_bounded(json['sourceText'], 4000) ||
        !_bounded(json['text'], 4000) ||
        json['final'] != true ||
        json['translated'] != (type == 'translation.final') ||
        translatedAudio['playbackGeneration'] !=
            grant.translation.playbackGeneration ||
        translatedAudio['available'] != false ||
        !const <String>{'disabled', 'not_ready'}
            .contains(translatedAudio['status'])) {
      throw const FormatException('Invalid enterprise meeting caption');
    }
    return EnterpriseMobileMeetingCaption(
      eventId: eventId,
      type: type,
      sourceDisplayName: _text(json, 'sourceDisplayName'),
      text: _text(json, 'text'),
      language: expectedLanguage,
      occurredAt: DateTime.parse(_text(json, 'occurredAt')),
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

bool _uuid(Object? value) =>
    value is String &&
    RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(value);

bool _bounded(Object? value, int maximum) =>
    value is String && value.trim().isNotEmpty && value.length <= maximum;
