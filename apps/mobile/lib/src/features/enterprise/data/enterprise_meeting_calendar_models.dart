class EnterpriseMobileMeetingCalendarSync {
  const EnterpriseMobileMeetingCalendarSync({
    required this.id,
    required this.meetingId,
    required this.status,
    required this.scheduledStartAt,
    required this.scheduledEndAt,
    required this.attempts,
    required this.version,
    this.providerEventId,
    this.providerWebUrl,
    this.lastErrorCode,
  });

  final String id, meetingId, status;
  final DateTime scheduledStartAt, scheduledEndAt;
  final int attempts, version;
  final String? providerEventId, lastErrorCode;
  final Uri? providerWebUrl;

  factory EnterpriseMobileMeetingCalendarSync.fromJson(
    Map<String, Object?> json,
  ) {
    final id = _text(json, 'id');
    final meetingId = _text(json, 'meetingId');
    final status = _text(json, 'status');
    final start = DateTime.parse(_text(json, 'scheduledStartAt'));
    final end = DateTime.parse(_text(json, 'scheduledEndAt'));
    final attempts = json['attempts'];
    final version = json['version'];
    final eventId = json['providerEventId'];
    final webUrlValue = json['providerWebUrl'];
    final webUrl = webUrlValue is String ? Uri.tryParse(webUrlValue) : null;
    final error = json['lastErrorCode'];
    final synced = status == 'synced';
    if (!_uuid(id) ||
        !_uuid(meetingId) ||
        json['provider'] != 'google_calendar' ||
        !const <String>{'pending', 'synced', 'failed'}.contains(status) ||
        !end.isAfter(start) ||
        attempts is! int ||
        attempts < 0 ||
        version is! int ||
        version < 1 ||
        (eventId != null && !_bounded(eventId, 1024)) ||
        (webUrlValue != null && !_publicHttps(webUrl)) ||
        (synced && (eventId == null || webUrl == null)) ||
        (!synced && (eventId != null || webUrl != null)) ||
        (status == 'failed' && error == null) ||
        (synced && error != null) ||
        (error != null &&
            (error is! String ||
                !RegExp(r'^[a-z][a-z0-9_]{1,63}$').hasMatch(error)))) {
      throw const FormatException('Invalid meeting calendar sync');
    }
    return EnterpriseMobileMeetingCalendarSync(
      id: id,
      meetingId: meetingId,
      status: status,
      scheduledStartAt: start,
      scheduledEndAt: end,
      attempts: attempts,
      version: version,
      providerEventId: eventId as String?,
      providerWebUrl: webUrl,
      lastErrorCode: error as String?,
    );
  }
}

String _text(Map<String, Object?> value, String key) {
  final result = value[key];
  if (result is! String || result.isEmpty) {
    throw const FormatException('Invalid text');
  }
  return result;
}

bool _uuid(String value) => RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(value);
bool _bounded(Object value, int maximum) =>
    value is String && value.isNotEmpty && value.codeUnits.length <= maximum;
bool _publicHttps(Uri? value) =>
    value != null &&
    value.scheme == 'https' &&
    value.userInfo.isEmpty &&
    value.host.isNotEmpty;
