import 'ai_calling_agent_api_client.dart';

abstract interface class AgentVoiceControlApi {
  Future<VoiceClientOwnership?> getVoiceOwnership({required String draftId});

  Future<VoiceClientOwnership> acquireVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  });

  Future<VoiceClientOwnership> renewVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    int leaseSeconds = 60,
  });

  Future<VoiceClientTakeover> requestVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required String takeoverId,
    required String clientInstanceId,
    required String participantIdentity,
    required int expectedGeneration,
  });

  Future<VoiceClientOwnership> confirmVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required VoiceClientTakeover takeover,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  });

  Future<void> releaseVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    required String reason,
  });

  Future<List<AgentWorkPermissionRequest>> listPendingWorkPermissions({
    required String draftId,
  });

  Future<AgentWorkPermissionRequest> resolveWorkPermission({
    required String draftId,
    required AgentWorkPermissionRequest permission,
    required String decision,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
  });

  Future<void> sendAgentDeliveryReceipt({
    required String draftId,
    required String deliveryAttemptId,
    required Map<String, Object?> receipt,
  });
}

class AiCallingAgentVoiceControlApi implements AgentVoiceControlApi {
  const AiCallingAgentVoiceControlApi(this.delegate);

  final AiCallingAgentApiClient delegate;

  @override
  Future<VoiceClientOwnership?> getVoiceOwnership({required String draftId}) =>
      delegate.getVoiceOwnership(draftId: draftId);

  @override
  Future<VoiceClientOwnership> acquireVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  }) =>
      delegate.acquireVoiceOwnership(
        draftId: draftId,
        commandId: commandId,
        clientInstanceId: clientInstanceId,
        participantIdentity: participantIdentity,
        leaseSeconds: leaseSeconds,
      );

  @override
  Future<VoiceClientOwnership> renewVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    int leaseSeconds = 60,
  }) =>
      delegate.renewVoiceOwnership(
        draftId: draftId,
        commandId: commandId,
        clientInstanceId: clientInstanceId,
        participantIdentity: participantIdentity,
        ownership: ownership,
        leaseSeconds: leaseSeconds,
      );

  @override
  Future<VoiceClientTakeover> requestVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required String takeoverId,
    required String clientInstanceId,
    required String participantIdentity,
    required int expectedGeneration,
  }) =>
      delegate.requestVoiceOwnershipTakeover(
        draftId: draftId,
        commandId: commandId,
        takeoverId: takeoverId,
        clientInstanceId: clientInstanceId,
        participantIdentity: participantIdentity,
        expectedGeneration: expectedGeneration,
      );

  @override
  Future<VoiceClientOwnership> confirmVoiceOwnershipTakeover({
    required String draftId,
    required String commandId,
    required VoiceClientTakeover takeover,
    required String clientInstanceId,
    required String participantIdentity,
    int leaseSeconds = 60,
  }) =>
      delegate.confirmVoiceOwnershipTakeover(
        draftId: draftId,
        commandId: commandId,
        takeover: takeover,
        clientInstanceId: clientInstanceId,
        participantIdentity: participantIdentity,
        leaseSeconds: leaseSeconds,
      );

  @override
  Future<void> releaseVoiceOwnership({
    required String draftId,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
    required String reason,
  }) =>
      delegate.releaseVoiceOwnership(
        draftId: draftId,
        commandId: commandId,
        clientInstanceId: clientInstanceId,
        participantIdentity: participantIdentity,
        ownership: ownership,
        reason: reason,
      );

  @override
  Future<List<AgentWorkPermissionRequest>> listPendingWorkPermissions({
    required String draftId,
  }) =>
      delegate.listPendingWorkPermissions(draftId: draftId);

  @override
  Future<AgentWorkPermissionRequest> resolveWorkPermission({
    required String draftId,
    required AgentWorkPermissionRequest permission,
    required String decision,
    required String commandId,
    required String clientInstanceId,
    required String participantIdentity,
    required VoiceClientOwnership ownership,
  }) =>
      delegate.resolveWorkPermission(
        draftId: draftId,
        permission: permission,
        decision: decision,
        commandId: commandId,
        clientInstanceId: clientInstanceId,
        participantIdentity: participantIdentity,
        ownership: ownership,
      );

  @override
  Future<void> sendAgentDeliveryReceipt({
    required String draftId,
    required String deliveryAttemptId,
    required Map<String, Object?> receipt,
  }) =>
      delegate.sendAgentDeliveryReceipt(
        draftId: draftId,
        deliveryAttemptId: deliveryAttemptId,
        receipt: receipt,
      );
}
