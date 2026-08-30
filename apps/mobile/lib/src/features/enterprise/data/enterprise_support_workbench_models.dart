import 'enterprise_support_models.dart';

class EnterpriseMobileAiSpeechFence {
  const EnterpriseMobileAiSpeechFence({
    required this.status,
    required this.verifiedAt,
    this.source,
    this.runId,
    this.runStatus,
  });

  final String status;
  final DateTime verifiedAt;
  final String? source;
  final String? runId;
  final String? runStatus;

  bool get stopsNewAiSpeech =>
      status == 'stopped' || status == 'not_started' || status == 'terminal';

  factory EnterpriseMobileAiSpeechFence.fromJson(
    Map<String, Object?> json,
  ) {
    final status = supportText(json, 'status', maximum: 32);
    final source = supportOptionalText(json, 'source', maximum: 32);
    if (!const <String>{'stopped', 'not_started', 'terminal'}
            .contains(status) ||
        (source != null &&
            !const <String>{'support_agent', 'marketing_agent'}
                .contains(source))) {
      throw const FormatException('Invalid enterprise AI speech fence');
    }
    return EnterpriseMobileAiSpeechFence(
      status: status,
      verifiedAt: supportTime(json, 'verifiedAt'),
      source: source,
      runId: supportOptionalUuid(json, 'runId'),
      runStatus: supportOptionalText(json, 'runStatus', maximum: 32),
    );
  }
}

class EnterpriseMobileSupportCustomer {
  const EnterpriseMobileSupportCustomer({
    required this.id,
    required this.consentScope,
    required this.updatedAt,
    this.displayName,
    this.externalId,
    this.locale,
  });

  final String id;
  final String? displayName;
  final String? externalId;
  final String? locale;
  final List<String> consentScope;
  final DateTime updatedAt;

  factory EnterpriseMobileSupportCustomer.fromJson(
    Map<String, Object?> json,
  ) {
    final consent = json['consentScope'];
    final attributes = json['attributes'];
    if (consent is! List<Object?> ||
        consent.any((item) => item is! String || item.length > 120) ||
        attributes is! Map<String, Object?>) {
      throw const FormatException('Invalid enterprise support customer');
    }
    return EnterpriseMobileSupportCustomer(
      id: supportUuid(json, 'id'),
      displayName: supportOptionalText(json, 'displayName', maximum: 120),
      externalId: supportOptionalText(json, 'externalId', maximum: 160),
      locale: supportOptionalText(json, 'locale', maximum: 32),
      consentScope: consent.cast<String>().toList(growable: false),
      updatedAt: supportTime(json, 'updatedAt'),
    );
  }
}

class EnterpriseMobileSupportQueueSummary {
  const EnterpriseMobileSupportQueueSummary({
    required this.id,
    required this.name,
    required this.status,
    required this.handoffSlaSeconds,
    required this.claimLeaseSeconds,
  });

  final String id;
  final String name;
  final String status;
  final int handoffSlaSeconds;
  final int claimLeaseSeconds;

  factory EnterpriseMobileSupportQueueSummary.fromJson(
    Map<String, Object?> json,
  ) {
    final status = supportText(json, 'status', maximum: 32);
    final sla = supportInteger(json, 'handoffSlaSeconds', minimum: 10);
    final lease = supportInteger(json, 'claimLeaseSeconds', minimum: 30);
    if (!const <String>{'active', 'paused', 'disabled'}.contains(status) ||
        sla > 86400 ||
        lease > 3600) {
      throw const FormatException('Invalid enterprise support queue summary');
    }
    return EnterpriseMobileSupportQueueSummary(
      id: supportUuid(json, 'id'),
      name: supportText(json, 'name', maximum: 120),
      status: status,
      handoffSlaSeconds: sla,
      claimLeaseSeconds: lease,
    );
  }
}

class EnterpriseMobileSupportCommunication {
  const EnterpriseMobileSupportCommunication({
    required this.sessionId,
    required this.status,
    required this.source,
    required this.updatedAt,
    this.generation,
  });

  final String sessionId;
  final String status;
  final String source;
  final DateTime updatedAt;
  final int? generation;

  factory EnterpriseMobileSupportCommunication.fromJson(
    Map<String, Object?> json,
  ) {
    final source = supportText(json, 'source', maximum: 32);
    final generation = json['generation'];
    if (!const <String>{'support_inbound', 'marketing_outbound'}
            .contains(source) ||
        (generation != null && (generation is! int || generation < 1))) {
      throw const FormatException('Invalid enterprise support communication');
    }
    return EnterpriseMobileSupportCommunication(
      sessionId: supportUuid(json, 'sessionId'),
      status: supportText(json, 'status', maximum: 48),
      source: source,
      updatedAt: supportTime(json, 'updatedAt'),
      generation: generation as int?,
    );
  }
}

class EnterpriseMobileSupportControl {
  const EnterpriseMobileSupportControl({
    required this.status,
    this.reasonCode,
    this.simulated,
  });

  final String status;
  final String? reasonCode;
  final bool? simulated;

  bool get ready => status == 'ready';

  factory EnterpriseMobileSupportControl.fromJson(
    Map<String, Object?> json,
  ) {
    final status = supportText(json, 'status', maximum: 32);
    final simulated = json['simulated'];
    if (!const <String>{'ready', 'forbidden', 'not_ready'}.contains(status) ||
        (simulated != null && simulated is! bool)) {
      throw const FormatException('Invalid enterprise support control');
    }
    return EnterpriseMobileSupportControl(
      status: status,
      reasonCode: supportOptionalText(json, 'reasonCode', maximum: 160),
      simulated: simulated as bool?,
    );
  }
}

class EnterpriseMobileSupportConversationTurn {
  const EnterpriseMobileSupportConversationTurn({
    required this.role,
    required this.text,
  });

  final String role;
  final String text;

  factory EnterpriseMobileSupportConversationTurn.fromJson(
    Map<String, Object?> json,
  ) {
    final role = supportText(json, 'role', maximum: 16);
    if (!const <String>{'customer', 'assistant'}.contains(role)) {
      throw const FormatException('Invalid enterprise conversation role');
    }
    return EnterpriseMobileSupportConversationTurn(
      role: role,
      text: supportText(json, 'text', maximum: 4000),
    );
  }
}

class EnterpriseMobileSupportWorkbench {
  const EnterpriseMobileSupportWorkbench({
    required this.generatedAt,
    required this.session,
    required this.claim,
    required this.aiSpeechFence,
    required this.channelType,
    required this.channelProvider,
    required this.channelStatus,
    required this.customer,
    required this.controls,
    required this.conversation,
    this.queue,
    this.communication,
  });

  final DateTime generatedAt;
  final EnterpriseMobileSupportSession session;
  final EnterpriseMobileSupportClaim claim;
  final EnterpriseMobileAiSpeechFence aiSpeechFence;
  final String channelType;
  final String channelProvider;
  final String channelStatus;
  final EnterpriseMobileSupportCustomer customer;
  final EnterpriseMobileSupportQueueSummary? queue;
  final EnterpriseMobileSupportCommunication? communication;
  final Map<String, EnterpriseMobileSupportControl> controls;
  final List<EnterpriseMobileSupportConversationTurn> conversation;

  EnterpriseMobileSupportControl? control(String name) => controls[name];

  factory EnterpriseMobileSupportWorkbench.fromJson(
    Map<String, Object?> json,
  ) {
    final queueJson = json['queue'];
    final communicationJson = json['communication'];
    final channel = supportMap(json, 'channel');
    final controlsJson = supportMap(json, 'controls');
    final conversationJson = json['conversationContext'];
    for (final field in const <String>[
      'cases',
      'callbacks',
      'followups',
      'toolExecutions',
      'agentTurns',
      'highRiskHandoffs',
      'transcriptSegments',
    ]) {
      if (json[field] is! List<Object?>) {
        throw FormatException('Invalid enterprise workbench $field');
      }
    }
    if (queueJson != null && queueJson is! Map<String, Object?> ||
        communicationJson != null &&
            communicationJson is! Map<String, Object?> ||
        conversationJson is! List<Object?>) {
      throw const FormatException('Invalid enterprise support workbench');
    }
    final controls = <String, EnterpriseMobileSupportControl>{};
    for (final entry in controlsJson.entries) {
      if (entry.value is! Map<String, Object?> || entry.key.length > 64) {
        throw const FormatException('Invalid enterprise workbench control');
      }
      controls[entry.key] = EnterpriseMobileSupportControl.fromJson(
        entry.value! as Map<String, Object?>,
      );
    }
    final conversation = conversationJson.map((item) {
      if (item is! Map<String, Object?>) {
        throw const FormatException('Invalid enterprise conversation');
      }
      return EnterpriseMobileSupportConversationTurn.fromJson(item);
    }).toList(growable: false);
    final session = EnterpriseMobileSupportSession.fromJson(
      supportMap(json, 'session'),
    );
    final claim = EnterpriseMobileSupportClaim.fromJson(
      supportMap(json, 'claim'),
      expectedSessionId: session.id,
    );
    return EnterpriseMobileSupportWorkbench(
      generatedAt: supportTime(json, 'generatedAt'),
      session: session,
      claim: claim,
      aiSpeechFence: EnterpriseMobileAiSpeechFence.fromJson(
        supportMap(json, 'aiSpeechFence'),
      ),
      channelType: supportText(channel, 'channelType', maximum: 32),
      channelProvider: supportText(channel, 'provider', maximum: 64),
      channelStatus: supportText(channel, 'status', maximum: 32),
      customer: EnterpriseMobileSupportCustomer.fromJson(
        supportMap(json, 'customer'),
      ),
      queue: queueJson == null
          ? null
          : EnterpriseMobileSupportQueueSummary.fromJson(
              queueJson as Map<String, Object?>,
            ),
      communication: communicationJson == null
          ? null
          : EnterpriseMobileSupportCommunication.fromJson(
              communicationJson as Map<String, Object?>,
            ),
      controls: Map<String, EnterpriseMobileSupportControl>.unmodifiable(
        controls,
      ),
      conversation: conversation,
    );
  }
}
