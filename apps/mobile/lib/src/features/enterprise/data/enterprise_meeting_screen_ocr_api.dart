import 'enterprise_meeting_screen_ocr_models.dart';
import 'enterprise_mobile_api_client.dart';
import 'enterprise_mobile_models.dart';

extension EnterpriseMeetingScreenOcrApi on EnterpriseMobileApiClient {
  Future<EnterpriseMobileScreenOcrView> currentMeetingScreenOcr(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
      '/screen-ocr/current',
      method: 'GET',
    );
    return EnterpriseMobileScreenOcrView.fromJson(json, meetingId);
  }

  Future<EnterpriseMobileScreenOcrView> enableMeetingScreenOcr(
    EnterpriseMobileWorkspace workspace,
    String meetingId, {
    required String shareId,
    required int expectedShareVersion,
    required String targetLanguage,
    required String displayMode,
    required String idempotencyKey,
  }) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
      '/screen-ocr/enable',
      method: 'POST',
      idempotencyKey: idempotencyKey,
      body: <String, Object?>{
        'shareId': shareId,
        'expectedShareVersion': expectedShareVersion,
        'targetLanguage': targetLanguage,
        'displayMode': displayMode,
      },
    );
    return EnterpriseMobileScreenOcrView.fromJson(json, meetingId);
  }

  Future<EnterpriseMobileScreenOcrView> disableMeetingScreenOcr(
    EnterpriseMobileWorkspace workspace,
    String meetingId, {
    required int expectedVersion,
    required String idempotencyKey,
  }) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
      '/screen-ocr/disable',
      method: 'POST',
      idempotencyKey: idempotencyKey,
      body: <String, Object?>{'expectedVersion': expectedVersion},
    );
    return EnterpriseMobileScreenOcrView.fromJson(json, meetingId);
  }
}
