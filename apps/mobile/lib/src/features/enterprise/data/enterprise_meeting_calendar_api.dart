import 'enterprise_meeting_calendar_models.dart';
import 'enterprise_mobile_api_client.dart';
import 'enterprise_mobile_models.dart';

extension EnterpriseMeetingCalendarApi on EnterpriseMobileApiClient {
  Future<EnterpriseMobileMeetingCalendarSync?> currentMeetingCalendarSync(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
  ) =>
      _request(workspace, meetingId, method: 'GET');

  Future<EnterpriseMobileMeetingCalendarSync> requestMeetingCalendarSync(
    EnterpriseMobileWorkspace workspace,
    String meetingId, {
    required int expectedMeetingVersion,
    required int durationMinutes,
    required String idempotencyKey,
  }) async =>
      (await _request(
        workspace,
        meetingId,
        method: 'POST',
        body: <String, Object?>{
          'expectedMeetingVersion': expectedMeetingVersion,
          'durationMinutes': durationMinutes,
        },
        idempotencyKey: idempotencyKey,
      ))!;

  Future<EnterpriseMobileMeetingCalendarSync?> _request(
    EnterpriseMobileWorkspace workspace,
    String meetingId, {
    required String method,
    Map<String, Object?>? body,
    String? idempotencyKey,
  }) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}/calendar-sync',
      method: method,
      body: body,
      idempotencyKey: idempotencyKey,
    );
    final value = json['sync'];
    if (value == null) return null;
    if (value is! Map<String, Object?>) {
      throw const FormatException('Invalid meeting calendar response');
    }
    final sync = EnterpriseMobileMeetingCalendarSync.fromJson(value);
    if (sync.meetingId != meetingId) {
      throw const EnterpriseMobileApiException(
        code: 'tenant_context_mismatch',
        message: 'Meeting calendar scope mismatch',
      );
    }
    return sync;
  }
}
