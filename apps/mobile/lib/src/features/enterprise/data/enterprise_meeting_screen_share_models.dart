class EnterpriseMobileScreenShare {
  const EnterpriseMobileScreenShare({
    required this.id,
    required this.meetingId,
    required this.participantId,
    required this.communicationSessionId,
    required this.sourceType,
    required this.qualityMode,
    required this.status,
    required this.generation,
    required this.publisherIdentity,
    required this.startedAt,
    required this.createdAt,
    required this.updatedAt,
    required this.version,
    this.trackSid,
    this.leaseExpiresAt,
    this.pausedAt,
    this.endedAt,
  });

  final String id;
  final String meetingId;
  final String participantId;
  final String communicationSessionId;
  final String sourceType;
  final String qualityMode;
  final String status;
  final int generation;
  final String publisherIdentity;
  final String? trackSid;
  final DateTime? leaseExpiresAt;
  final DateTime startedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? pausedAt;
  final DateTime? endedAt;
  final int version;

  factory EnterpriseMobileScreenShare.fromJson(
    Map<String, Object?> json,
    String expectedMeetingId,
  ) {
    final id = _text(json, 'id');
    final meetingId = _text(json, 'meetingId');
    final participantId = _text(json, 'participantId');
    final communicationSessionId = _text(json, 'communicationSessionId');
    final sourceType = _text(json, 'sourceType');
    final qualityMode = _text(json, 'qualityMode');
    final status = _text(json, 'status');
    final generation = json['generation'];
    final version = json['version'];
    final publisherIdentity = _text(json, 'publisherIdentity');
    final trackSid = _optionalText(json, 'trackSid');
    final leaseExpiresAt = _optionalTime(json, 'leaseExpiresAt');
    final pausedAt = _optionalTime(json, 'pausedAt');
    final endedAt = _optionalTime(json, 'endedAt');
    if (!_uuid(id) ||
        meetingId != expectedMeetingId ||
        !_uuid(participantId) ||
        !_uuid(communicationSessionId) ||
        !const <String>{'screen', 'window', 'tab'}.contains(sourceType) ||
        json['includesSystemAudio'] != false ||
        !const <String>{'auto', 'smooth', 'high'}.contains(qualityMode) ||
        !const <String>{'active', 'paused', 'ended', 'expired'}
            .contains(status) ||
        generation is! int ||
        generation < 1 ||
        version is! int ||
        version < 1 ||
        publisherIdentity != 'ent-share:$id:g$generation' ||
        (trackSid != null && !_bounded(trackSid, 128)) ||
        ((status == 'active' || status == 'paused') &&
            leaseExpiresAt == null)) {
      throw const FormatException('Invalid enterprise screen share');
    }
    return EnterpriseMobileScreenShare(
      id: id,
      meetingId: meetingId,
      participantId: participantId,
      communicationSessionId: communicationSessionId,
      sourceType: sourceType,
      qualityMode: qualityMode,
      status: status,
      generation: generation,
      publisherIdentity: publisherIdentity,
      trackSid: trackSid,
      leaseExpiresAt: leaseExpiresAt,
      startedAt: DateTime.parse(_text(json, 'startedAt')),
      createdAt: DateTime.parse(_text(json, 'createdAt')),
      updatedAt: DateTime.parse(_text(json, 'updatedAt')),
      pausedAt: pausedAt,
      endedAt: endedAt,
      version: version,
    );
  }
}

class EnterpriseMobileScreenShareGrant {
  const EnterpriseMobileScreenShareGrant({
    required this.roomName,
    required this.rtcUrl,
    required this.publisherIdentity,
    required this.accessToken,
    required this.expiresAt,
    required this.generation,
  });

  final String roomName;
  final Uri rtcUrl;
  final String publisherIdentity;
  final String accessToken;
  final DateTime expiresAt;
  final int generation;

  factory EnterpriseMobileScreenShareGrant.fromJson(
    Map<String, Object?> json,
    EnterpriseMobileScreenShare share,
    Uri expectedRtcUrl,
  ) {
    final rtcUrl = Uri.parse(_text(json, 'rtcUrl'));
    final expiresAt = DateTime.parse(_text(json, 'expiresAt'));
    final token = _text(json, 'accessToken');
    final capabilities = _map(json, 'capabilities');
    final validCapabilities = capabilities['screenShare'] == true &&
        capabilities['screenShareAudio'] == false &&
        capabilities['microphone'] == false &&
        capabilities['camera'] == false &&
        capabilities['data'] == false &&
        capabilities['subscribe'] == false;
    final leaseExpiry = share.leaseExpiresAt;
    final now = DateTime.now();
    if (_text(json, 'provider') != 'livekit' ||
        !_sameRtcUrl(rtcUrl, expectedRtcUrl) ||
        _text(json, 'publisherIdentity') != share.publisherIdentity ||
        json['generation'] != share.generation ||
        _text(json, 'roomName') !=
            'ent_${share.communicationSessionId.replaceAll('-', '')}' ||
        token.length < 64 ||
        token.length > 8192 ||
        token.split('.').length != 3 ||
        !expiresAt.isAfter(now) ||
        expiresAt.isAfter(now.add(const Duration(seconds: 125))) ||
        leaseExpiry == null ||
        expiresAt.isAfter(leaseExpiry) ||
        !validCapabilities) {
      throw const FormatException('Invalid enterprise screen share grant');
    }
    return EnterpriseMobileScreenShareGrant(
      roomName: _text(json, 'roomName'),
      rtcUrl: rtcUrl,
      publisherIdentity: share.publisherIdentity,
      accessToken: token,
      expiresAt: expiresAt,
      generation: share.generation,
    );
  }
}

class EnterpriseMobileScreenShareResponse {
  const EnterpriseMobileScreenShareResponse({
    required this.share,
    required this.revocation,
    this.grant,
  });

  final EnterpriseMobileScreenShare share;
  final EnterpriseMobileScreenShareGrant? grant;
  final String revocation;

  factory EnterpriseMobileScreenShareResponse.fromJson(
    Map<String, Object?> json, {
    required String meetingId,
    required Uri expectedRtcUrl,
    required bool grantRequired,
  }) {
    final share = EnterpriseMobileScreenShare.fromJson(
      _map(json, 'share'),
      meetingId,
    );
    final revocation = _text(json, 'revocation');
    final grantJson = json['grant'];
    if (!const <String>{'not_required', 'completed', 'pending'}
            .contains(revocation) ||
        (json['replayed'] != null && json['replayed'] != true) ||
        (grantRequired &&
            share.status == 'active' &&
            grantJson is! Map<String, Object?>) ||
        (!grantRequired && grantJson != null)) {
      throw const FormatException('Invalid enterprise screen share response');
    }
    return EnterpriseMobileScreenShareResponse(
      share: share,
      revocation: revocation,
      grant: grantJson is Map<String, Object?>
          ? EnterpriseMobileScreenShareGrant.fromJson(
              grantJson,
              share,
              expectedRtcUrl,
            )
          : null,
    );
  }
}

Map<String, Object?> _map(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map<String, Object?>) {
    throw FormatException('Invalid enterprise screen share $key');
  }
  return value;
}

String _text(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid enterprise screen share $key');
  }
  return value;
}

String? _optionalText(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid enterprise screen share $key');
  }
  return value;
}

DateTime? _optionalTime(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is! String) {
    throw FormatException('Invalid enterprise screen share $key');
  }
  return DateTime.parse(value);
}

bool _sameRtcUrl(Uri first, Uri second) {
  String canonical(Uri value) =>
      '${value.scheme}://${value.authority}${value.path.replaceFirst(RegExp(r'/$'), '')}';
  return first.scheme == 'wss' && canonical(first) == canonical(second);
}

bool _uuid(Object? value) =>
    value is String &&
    RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(value);

bool _bounded(Object? value, int maximum) =>
    value is String && value.trim().isNotEmpty && value.length <= maximum;
