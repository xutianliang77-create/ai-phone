part of 'ai_calling_agent_api_client.dart';

extension AiCallingAgentVoiceApi on AiCallingAgentApiClient {
  Future<VoiceClientOwnership?> getVoiceOwnership({
    required String draftId,
  }) async {
    final response = await _client.get(
      _baseUrl.resolve('/ai-calling-agent/drafts/$draftId/voice-ownership'),
      headers: await _authHeaders(),
    );
    final json = _jsonResponse(response, 'Get voice ownership failed');
    final ownership = json['ownership'];
    if (ownership == null) return null;
    if (ownership is! Map<String, Object?>) {
      throw const FormatException('Invalid voice ownership response');
    }
    return VoiceClientOwnership.fromJson(ownership);
  }

  Future<VoiceClientOwnership> acquireVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  }) async {
    final json = await _postJson(
      '/ai-calling-agent/drafts/$draftId/voice-ownership/acquire',
      <String, Object?>{
        'commandId': commandId,
        'clientInstanceId': clientInstanceId,
        'participantIdentity': participantIdentity,
        'leaseSeconds': leaseSeconds,
      },
      'Acquire voice ownership failed',
    );
    return VoiceClientOwnership.fromJson(
      json['ownership']! as Map<String, Object?>,
    );
  }

  Future<VoiceClientOwnership> renewVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    int leaseSeconds = 60,
  }) async {
    final json = await _postJson(
      '/ai-calling-agent/drafts/$draftId/voice-ownership/renew',
      <String, Object?>{
        'commandId': commandId,
        'clientInstanceId': clientInstanceId,
        'participantIdentity': participantIdentity,
        'leaseId': ownership.leaseId,
        'generation': ownership.generation,
        'leaseSeconds': leaseSeconds,
      },
      'Renew voice ownership failed',
    );
    return VoiceClientOwnership.fromJson(
      json['ownership']! as Map<String, Object?>,
    );
  }

  Future<VoiceClientTakeover> requestVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required String takeoverId,
    required String clientInstanceId,
    required String participantIdentity,
    required int expectedGeneration,
  }) async {
    final json = await _postJson(
      '/ai-calling-agent/drafts/$draftId/voice-ownership/takeover',
      <String, Object?>{
        'commandId': commandId,
        'takeoverId': takeoverId,
        'clientInstanceId': clientInstanceId,
        'participantIdentity': participantIdentity,
        'expectedGeneration': expectedGeneration,
      },
      'Request voice ownership takeover failed',
    );
    return VoiceClientTakeover.fromJson(
      json['takeover']! as Map<String, Object?>,
    );
  }

  Future<VoiceClientOwnership> confirmVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required VoiceClientTakeover takeover,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  }) async {
    final json = await _postJson(
      '/ai-calling-agent/drafts/$draftId/voice-ownership/takeover/'
      '${takeover.takeoverId}/confirm',
      <String, Object?>{
        'commandId': commandId,
        'takeoverId': takeover.takeoverId,
        'clientInstanceId': clientInstanceId,
        'participantIdentity': participantIdentity,
        'expectedGeneration': takeover.expectedGeneration,
        'leaseSeconds': leaseSeconds,
      },
      'Confirm voice ownership takeover failed',
    );
    return VoiceClientOwnership.fromJson(
      json['ownership']! as Map<String, Object?>,
    );
  }

  Future<void> releaseVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    required String reason,
  }) async {
    await _postJson(
      '/ai-calling-agent/drafts/$draftId/voice-ownership/release',
      <String, Object?>{
        'commandId': commandId,
        'clientInstanceId': clientInstanceId,
        'participantIdentity': participantIdentity,
        'leaseId': ownership.leaseId,
        'generation': ownership.generation,
        'reason': reason,
      },
      'Release voice ownership failed',
    );
  }

  Future<List<AgentWorkPermissionRequest>> listPendingWorkPermissions({
    required String draftId,
  }) async {
    final response = await _client.get(
      _baseUrl.resolve(
        '/ai-calling-agent/drafts/$draftId/agent-work/permissions',
      ),
      headers: await _authHeaders(),
    );
    final json = _jsonResponse(response, 'List Agent Work permissions failed');
    final values = json['permissions'];
    if (values is! List<Object?>) {
      throw const FormatException('Invalid Agent Work permission response');
    }
    return values.map((value) {
      if (value is! Map<String, Object?>) {
        throw const FormatException('Invalid Agent Work permission response');
      }
      return AgentWorkPermissionRequest.fromJson(value);
    }).toList(growable: false);
  }

  Future<AgentWorkPermissionRequest> resolveWorkPermission({
    required String draftId,
    required AgentWorkPermissionRequest permission,
    required String decision,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
  }) async {
    final json = await _postJson(
      '/ai-calling-agent/drafts/$draftId/agent-work/permissions/'
      '${permission.permissionRequestId}/resolve',
      <String, Object?>{
        'decision': decision,
        'commandId': commandId,
        'clientInstanceId': clientInstanceId,
        'participantIdentity': participantIdentity,
        'ownershipLeaseId': ownership.leaseId,
        'ownershipGeneration': ownership.generation,
        'confirmedAt': DateTime.now().toUtc().toIso8601String(),
        'turnGeneration': permission.turnGeneration,
        'dispatchGeneration': permission.dispatchGeneration,
      },
      'Resolve Agent Work permission failed',
    );
    return AgentWorkPermissionRequest.fromJson(
      json['permission']! as Map<String, Object?>,
    );
  }

  Future<void> sendAgentDeliveryReceipt({
    required String draftId,
    required String deliveryAttemptId,
    required Map<String, Object?> receipt,
  }) async {
    await _postJson(
      '/ai-calling-agent/drafts/$draftId/agent-deliveries/'
      '$deliveryAttemptId/receipts',
      receipt,
      'Send Agent delivery receipt failed',
    );
  }
}
