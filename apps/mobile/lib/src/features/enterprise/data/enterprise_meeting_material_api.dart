import 'enterprise_meeting_material_models.dart';
import 'enterprise_mobile_api_client.dart';
import 'enterprise_mobile_models.dart';

extension EnterpriseMeetingMaterialApi on EnterpriseMobileApiClient {
  Future<EnterpriseMeetingMaterial?> currentMeetingMaterial(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}/materials/current',
      method: 'GET',
    );
    final material = json['material'];
    if (material == null) return null;
    if (material is! Map<String, Object?>) {
      throw const FormatException('Invalid meeting material response');
    }
    final parsed = EnterpriseMeetingMaterial.fromJson(material);
    _sameMeeting(parsed, meetingId);
    return parsed;
  }

  Future<int> endMeetingForMaterials(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
    int expectedVersion,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}/end',
      method: 'POST',
      body: <String, Object?>{'expectedVersion': expectedVersion},
    );
    final version = json['version'];
    if (json['meetingId'] != meetingId ||
        json['status'] != 'ended' ||
        version is! int ||
        version < 1) {
      throw const FormatException('Invalid meeting end response');
    }
    return version;
  }

  Future<EnterpriseMeetingMaterial> generateMeetingMaterial(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
    int expectedMeetingVersion,
    String idempotencyKey,
  ) =>
      _materialMutation(
        workspace,
        meetingId,
        '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}/materials/generate',
        body: <String, Object?>{
          'expectedMeetingVersion': expectedMeetingVersion
        },
        idempotencyKey: idempotencyKey,
        timeout: const Duration(seconds: 40),
      );

  Future<EnterpriseMeetingMaterial> publishMeetingMaterial(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMeetingMaterial material,
  ) =>
      _materialMutation(
        workspace,
        material.run.meetingId,
        '/enterprise/v1/meetings/${Uri.encodeComponent(material.run.meetingId)}'
        '/materials/${Uri.encodeComponent(material.run.id)}/publish',
        body: <String, Object?>{'expectedVersion': material.run.version},
      );

  Future<EnterpriseMeetingMaterial> updateMeetingMaterialAction(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMeetingMaterial material,
    EnterpriseMeetingMaterialActionItem action,
    String status,
  ) =>
      _materialMutation(
        workspace,
        material.run.meetingId,
        '/enterprise/v1/meetings/${Uri.encodeComponent(material.run.meetingId)}'
        '/materials/${Uri.encodeComponent(material.run.id)}/actions/'
        '${Uri.encodeComponent(action.id)}',
        method: 'PUT',
        body: <String, Object?>{
          'status': status,
          'expectedVersion': action.version
        },
      );

  Future<EnterpriseMeetingMaterial> updateMeetingMaterialSpeaker(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMeetingMaterial material,
    String participantId,
    String displayName,
  ) =>
      _materialMutation(
        workspace,
        material.run.meetingId,
        '/enterprise/v1/meetings/${Uri.encodeComponent(material.run.meetingId)}'
        '/materials/${Uri.encodeComponent(material.run.id)}/speakers/'
        '${Uri.encodeComponent(participantId)}',
        method: 'PUT',
        body: <String, Object?>{
          'displayName': displayName,
          'expectedVersion': material.run.version,
        },
      );

  Future<EnterpriseMeetingMaterial> _materialMutation(
    EnterpriseMobileWorkspace workspace,
    String meetingId,
    String path, {
    String method = 'POST',
    required Map<String, Object?> body,
    String? idempotencyKey,
    Duration? timeout,
  }) async {
    final json = await contentRequest(
      workspace,
      path,
      method: method,
      body: body,
      idempotencyKey: idempotencyKey,
      timeout: timeout,
    );
    final value = json['material'];
    if (value is! Map<String, Object?>) {
      throw const FormatException('Invalid meeting material response');
    }
    final material = EnterpriseMeetingMaterial.fromJson(value);
    _sameMeeting(material, meetingId);
    return material;
  }
}

void _sameMeeting(EnterpriseMeetingMaterial material, String meetingId) {
  if (material.run.meetingId != meetingId) {
    throw const EnterpriseMobileApiException(
      code: 'tenant_context_mismatch',
      message: 'Meeting material scope mismatch',
    );
  }
}
