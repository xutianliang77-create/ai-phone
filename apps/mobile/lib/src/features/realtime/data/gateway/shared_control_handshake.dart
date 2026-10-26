part of 'realtime_gateway_client.dart';

extension _CloudflareDeviceChallenge on RealtimeGatewayClient {
  bool _handleControlChallenge(int generation, Map<String, Object?> body) {
    final started = _started, session = _session;
    if (session?.controlBinding == null) return false;
    if (body['type'] == 'session.control.challenge') {
      unawaited(() async {
        try {
          final encoded = body['clientData'];
          if (encoded is! String || encoded.length > 22000) {
            throw const FormatException('control_challenge');
          }
          final data = jsonDecode(utf8.decode(base64Decode(encoded))) as Map,
              binding = session!.controlBinding!;
          if (data['sessionId'] != session.sessionId ||
              data['ownerId'] != binding['ownerId'] ||
              data['deploymentId'] != binding['deploymentId'] ||
              data['deviceKeyHash'] != binding['deviceKeyHash'] ||
              data['planHash'] != binding['planHash']) {
            throw const FormatException('control_challenge_binding');
          }
          await _accountOperation!.check();
          final proof =
              (controlProofFactory ??
              ((owner) => SharedControlProofClient(ownerId: owner)))(
                binding['ownerId']! as String,
              );
          final signature = await proof.connection(encoded, session.sessionId);
          await _accountOperation!.check();
          if (generation != _connectionGeneration) {
            throw StateError('control_connection_superseded');
          }
          _send({
            'type': 'session.control.proof',
            'sessionId': session.sessionId,
            'signature': signature,
          });
        } catch (error) {
          if (started != null && !started.isCompleted) {
            started.completeError(error);
          }
          unawaited(_channel?.sink.close());
        }
      }());
      return true;
    }
    if (started != null && !started.isCompleted) {
      if (body['type'] == 'session.started' &&
          body['sessionId'] == session!.sessionId) {
        started.complete();
      }
      if (body['type'] == 'error' || body['type'] == 'session.ended') {
        started.completeError(StateError('control_start_unconfirmed'));
      }
    }
    return false;
  }
}
