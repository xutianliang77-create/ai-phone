part of 'call_link_api_client.dart';

Future<PhoneCallStatus> _getPhoneStatus(
  CallLinkApiClient client,
  String callId,
) async {
  final response = await client._client.get(
    client._baseUrl.resolve('/call-links/$callId/phone-status'),
    headers: await client._authHeaders(),
  );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw client._failure(response, 'Get phone call status failed');
  }
  return Air780CallStatus.fromJson(
    jsonDecode(response.body) as Map<String, Object?>,
  );
}
