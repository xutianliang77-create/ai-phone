import 'enterprise_meeting_models.dart';
import 'enterprise_meeting_screen_share_models.dart';
import 'enterprise_mobile_api_client.dart';
import 'enterprise_mobile_models.dart';

extension EnterpriseMeetingScreenShareApi on EnterpriseMobileApiClient {
  Future<int> getMeetingVersion(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}',
      method: 'GET',
    );
    final value = json['meeting'];
    if (value is! Map<String, Object?>) {
      throw const FormatException('Invalid enterprise meeting response');
    }
    final aggregate = EnterpriseMobileMeetingAggregate.fromJson(value);
    if (aggregate.meeting.id != meetingId) {
      throw const FormatException('Enterprise meeting mismatch');
    }
    return aggregate.meeting.version;
  }

  Future<EnterpriseMobileScreenShare?> currentScreenShare(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
          '/screen-shares/current',
      method: 'GET',
    );
    final revocation = json['revocation'];
    if (!const <String>{'not_required', 'completed', 'pending'}
        .contains(revocation)) {
      throw const FormatException('Invalid screen share revocation');
    }
    final share = json['share'];
    if (share == null) return null;
    if (share is! Map<String, Object?>) {
      throw const FormatException('Invalid enterprise screen share');
    }
    return EnterpriseMobileScreenShare.fromJson(share, meetingId);
  }

  Future<EnterpriseMobileScreenShareResponse> acquireScreenShare(
    EnterpriseMobileWorkspace workspace,
    String meetingId, {
    required String qualityMode,
    required int expectedMeetingVersion,
    required String idempotencyKey,
  }) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
          '/screen-shares/acquire',
      method: 'POST',
      idempotencyKey: idempotencyKey,
      body: <String, Object?>{
        'sourceType': 'screen',
        'includesSystemAudio': false,
        'qualityMode': qualityMode,
        'expectedMeetingVersion': expectedMeetingVersion,
      },
    );
    return EnterpriseMobileScreenShareResponse.fromJson(
      json,
      meetingId: meetingId,
      expectedRtcUrl: workspace.route.rtcUrl,
      grantRequired: true,
    );
  }

  Future<EnterpriseMobileScreenShareResponse> commandScreenShare(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
    EnterpriseMobileScreenShare share,
    String command, {
    required String idempotencyKey,
    String? trackSid,
  }) async {
    if (!const <String>{'renew', 'stop'}.contains(command)) {
      throw ArgumentError('Unsupported iOS screen share command');
    }
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
          '/screen-shares/${Uri.encodeComponent(share.id)}/$command',
      method: 'POST',
      idempotencyKey: idempotencyKey,
      body: <String, Object?>{
        'expectedVersion': share.version,
        if (trackSid != null) 'trackSid': trackSid,
      },
    );
    return EnterpriseMobileScreenShareResponse.fromJson(
      json,
      meetingId: meetingId,
      expectedRtcUrl: workspace.route.rtcUrl,
      grantRequired: command == 'renew',
    );
  }

  Future<EnterpriseMobileScreenShareResponse> forceStopScreenShare(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
    EnterpriseMobileScreenShare share, {
    required String idempotencyKey,
  }) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}'
          '/screen-shares/${Uri.encodeComponent(share.id)}/force-stop',
      method: 'POST',
      idempotencyKey: idempotencyKey,
      body: <String, Object?>{'expectedVersion': share.version},
    );
    return EnterpriseMobileScreenShareResponse.fromJson(
      json,
      meetingId: meetingId,
      expectedRtcUrl: workspace.route.rtcUrl,
      grantRequired: false,
    );
  }
}
