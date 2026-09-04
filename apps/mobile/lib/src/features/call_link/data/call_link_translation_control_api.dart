part of 'call_link_api_client.dart';

Future<CallDiagnosticMarkerResult> _reportCallDiagnosticMarker(
  CallLinkApiClient client,
  String callId,
  String category,
  String idempotencyKey,
) async {
  final response = await client._client.post(
    client._baseUrl.resolve('/call-links/$callId/diagnostic-marker'),
    headers: await client._authHeaders(json: true),
    body: jsonEncode({
      'category': category,
      'idempotencyKey': idempotencyKey,
    }),
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw client._failure(response, 'Report call diagnostic marker failed');
  }
  return CallDiagnosticMarkerResult.fromJson(
    jsonDecode(response.body) as Map<String, Object?>,
  );
}

Future<TranslationCallControlResult> _typeToSpeak(
  CallLinkApiClient client,
  String callId,
  String text,
  String idempotencyKey,
) {
  return _translationControl(
    client: client,
    callId: callId,
    action: 'type-to-speak',
    body: {'text': text, 'idempotencyKey': idempotencyKey},
  );
}

Future<TranslationCallControlResult> _setTranslationUplinkPaused(
  CallLinkApiClient client,
  String callId,
  bool paused,
  String idempotencyKey,
) {
  return _translationControl(
    client: client,
    callId: callId,
    action: 'translation-uplink',
    body: {'paused': paused, 'idempotencyKey': idempotencyKey},
  );
}

Future<TranslationCallControlResult> _getTranslationControlStatus(
  CallLinkApiClient client,
  String callId,
  String operationId,
) async {
  final response = await client._client.get(
    client._baseUrl.resolve(
      '/call-links/$callId/translation-controls/$operationId',
    ),
    headers: await client._authHeaders(),
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw client._failure(response, 'Get translation control status failed');
  }
  return TranslationCallControlResult.fromJson(
    jsonDecode(response.body) as Map<String, Object?>,
  );
}

Future<TranslationCallControlResult> _translationControl({
  required CallLinkApiClient client,
  required String callId,
  required String action,
  required Map<String, Object?> body,
}) async {
  final response = await client._client.post(
    client._baseUrl.resolve('/call-links/$callId/$action'),
    headers: await client._authHeaders(json: true),
    body: jsonEncode(body),
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw client._failure(response, 'Translation call control failed');
  }
  return TranslationCallControlResult.fromJson(
    jsonDecode(response.body) as Map<String, Object?>,
  );
}
