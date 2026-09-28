part of 'realtime_gateway_client.dart';

extension _RealtimeGatewayTextLanguage on RealtimeGatewayClient {
  Future<void> _answerTextLanguage(
      int generation, Map<String, Object?> request) async {
    final session = _session, channel = _channel;
    if (session?.syncBinding == null ||
        session == null ||
        channel == null ||
        _textLanguageClosed ||
        !supportsDeviceTextLanguage ||
        _textLanguagePending.length >= 32) {
      return;
    }
    final id = request['requestId'];
    if (id is! String || _textLanguageSeen.contains(id)) return;
    _textLanguageSeen.add(id);
    if (_textLanguageSeen.length > 256) {
      _textLanguageSeen.remove(_textLanguageSeen.first);
    }
    _textLanguagePending.add(id);
    try {
      final reply = await answerTextLanguageChallenge(
          request, session.sessionId, analyzeDeviceTextLanguage);
      // _manualClose becomes true on the End button. The confirmed final flush
      // still needs a tail sentence's language until session.ended arrives.
      if (reply != null &&
          !_textLanguageClosed &&
          generation == _connectionGeneration &&
          identical(channel, _channel) &&
          identical(session, _session)) {
        channel.sink.add(jsonEncode(reply));
      }
    } finally {
      _textLanguagePending.remove(id);
    }
  }
}
