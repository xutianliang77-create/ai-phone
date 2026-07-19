import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/realtime_session.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/realtime_gateway_client.dart';

void main() {
  test('keeps realtime token out of the websocket URL', () {
    final session = RealtimeSession(
      sessionId: 'session-one',
      realtimeToken: 'signed.jwt.token',
      endpoint: Uri.parse('ws://gateway.example/realtime?region=cn'),
      expiresAt: DateTime.utc(2026),
      maxDurationSeconds: 300,
    );

    expect(realtimeGatewayEndpoint(session).queryParameters, {'region': 'cn'});
    expect(
        realtimeGatewayEndpoint(session).toString(), isNot(contains('token')));
    expect(realtimeGatewayProtocols(session), [
      'ai-phone.realtime.v1',
      'ai-phone.token.signed.jwt.token',
    ]);
  });
}
