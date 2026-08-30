import 'enterprise_mobile_api_client.dart';
import 'enterprise_mobile_models.dart';
import 'enterprise_support_models.dart';
import 'enterprise_support_workbench_models.dart';

extension EnterpriseMobileSupportApi on EnterpriseMobileApiClient {
  Future<List<EnterpriseMobileSupportQueue>> listSupportQueues(
    EnterpriseMobileWorkspace workspace,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/queues',
      method: 'GET',
    );
    final values = json['queues'];
    if (values is! List<Object?>) {
      throw const FormatException('Invalid enterprise support queues');
    }
    return values.map((item) {
      if (item is! Map<String, Object?>) {
        throw const FormatException('Invalid enterprise support queue');
      }
      return EnterpriseMobileSupportQueue.fromJson(item);
    }).toList(growable: false);
  }

  Future<List<EnterpriseMobileSupportWorkItem>> listSupportWorkItems(
    EnterpriseMobileWorkspace workspace,
    String queueId,
  ) async {
    if (!supportUuidValue(queueId)) {
      throw const FormatException('Invalid enterprise support queue id');
    }
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/queues/${Uri.encodeComponent(queueId)}/work-items',
      method: 'GET',
    );
    if (json['status'] != 'ready' || json['workItems'] is! List<Object?>) {
      throw const FormatException('Invalid enterprise support work items');
    }
    return (json['workItems']! as List<Object?>).map((item) {
      if (item is! Map<String, Object?>) {
        throw const FormatException('Invalid enterprise support work item');
      }
      final workItem = EnterpriseMobileSupportWorkItem.fromJson(item);
      if (workItem.queueId != queueId) {
        throw const EnterpriseMobileApiException(
          code: 'tenant_context_mismatch',
          message: 'Enterprise support queue mismatch',
        );
      }
      return workItem;
    }).toList(growable: false);
  }

  Future<EnterpriseMobileSupportClaimResult> claimSupportSession(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMobileSupportWorkItem workItem,
    String idempotencyKey,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/sessions/'
      '${Uri.encodeComponent(workItem.sessionId)}/claims',
      method: 'POST',
      body: <String, Object?>{
        'expectedSessionVersion': workItem.expectedSessionVersion,
        'idempotencyKey': idempotencyKey,
      },
    );
    final result = EnterpriseMobileSupportClaimResult.fromJson(json);
    _validateClaim(
      workspace,
      result.claim,
      result.session,
      sessionId: workItem.sessionId,
      queueId: workItem.queueId,
    );
    return result;
  }

  Future<EnterpriseMobileSupportWorkbench> activateSupportWorkbench(
    EnterpriseMobileWorkspace workspace,
    String sessionId,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/sessions/${Uri.encodeComponent(sessionId)}/workbench',
      method: 'POST',
      body: const <String, Object?>{},
    );
    return _workbench(workspace, sessionId, json);
  }

  Future<EnterpriseMobileSupportWorkbench> getSupportWorkbench(
    EnterpriseMobileWorkspace workspace,
    String sessionId,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/sessions/${Uri.encodeComponent(sessionId)}/workbench',
      method: 'GET',
    );
    return _workbench(workspace, sessionId, json);
  }

  Future<EnterpriseMobileSupportClaim> renewSupportClaim(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMobileSupportClaim claim,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/claims/${Uri.encodeComponent(claim.id)}/renew',
      method: 'POST',
      body: <String, Object?>{'expectedClaimVersion': claim.version},
    );
    final renewed = EnterpriseMobileSupportClaim.fromJson(
      supportMap(json, 'claim'),
    );
    if (renewed.id != claim.id ||
        renewed.supportSessionId != claim.supportSessionId ||
        renewed.agentUserId != workspace.context.member.userId ||
        renewed.status != 'active') {
      throw const EnterpriseMobileApiException(
        code: 'tenant_context_mismatch',
        message: 'Enterprise support claim renewal mismatch',
      );
    }
    return renewed;
  }

  Future<EnterpriseMobileSupportReleaseResult> releaseSupportClaim(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMobileSupportClaim claim,
    EnterpriseMobileSupportSession session,
    String idempotencyKey, {
    required String reason,
  }) async {
    if (!const <String>{'agent_release', 'agent_disconnect'}.contains(reason)) {
      throw const FormatException('Invalid enterprise support release reason');
    }
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/support/claims/${Uri.encodeComponent(claim.id)}/release',
      method: 'POST',
      body: <String, Object?>{
        'expectedClaimVersion': claim.version,
        'expectedSessionVersion': session.version,
        'idempotencyKey': idempotencyKey,
        'reason': reason,
      },
    );
    final result = EnterpriseMobileSupportReleaseResult.fromJson(json);
    if (result.claim.id != claim.id ||
        result.claim.supportSessionId != session.id ||
        result.claim.agentUserId != workspace.context.member.userId ||
        result.claim.status != 'released' ||
        result.session.id != session.id) {
      throw const EnterpriseMobileApiException(
        code: 'tenant_context_mismatch',
        message: 'Enterprise support release mismatch',
      );
    }
    return result;
  }

  EnterpriseMobileSupportWorkbench _workbench(
    EnterpriseMobileWorkspace workspace,
    String sessionId,
    Map<String, Object?> json,
  ) {
    final workbench = EnterpriseMobileSupportWorkbench.fromJson(json);
    _validateClaim(
      workspace,
      workbench.claim,
      workbench.session,
      sessionId: sessionId,
      queueId: workbench.claim.queueId,
    );
    if (!workbench.aiSpeechFence.stopsNewAiSpeech) {
      throw const EnterpriseMobileApiException(
        code: 'ai_speech_fence_not_ready',
        message: 'Enterprise AI speech fence is not ready',
      );
    }
    return workbench;
  }

  void _validateClaim(
    EnterpriseMobileWorkspace workspace,
    EnterpriseMobileSupportClaim claim,
    EnterpriseMobileSupportSession session, {
    required String sessionId,
    required String queueId,
  }) {
    if (claim.supportSessionId != sessionId ||
        claim.queueId != queueId ||
        claim.agentUserId != workspace.context.member.userId ||
        session.id != sessionId ||
        session.queueId != queueId ||
        session.assignedUserId != workspace.context.member.userId ||
        (session.activeAgentClaimId != null &&
            session.activeAgentClaimId != claim.id) ||
        session.status != 'human_active' ||
        claim.status != 'active') {
      throw const EnterpriseMobileApiException(
        code: 'tenant_context_mismatch',
        message: 'Enterprise support claim context mismatch',
      );
    }
  }
}
