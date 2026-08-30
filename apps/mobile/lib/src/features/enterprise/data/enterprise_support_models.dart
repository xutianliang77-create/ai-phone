class EnterpriseMobileSupportQueue {
  const EnterpriseMobileSupportQueue({
    required this.id,
    required this.name,
    required this.status,
    required this.defaultPriority,
    required this.handoffSlaSeconds,
    required this.claimLeaseSeconds,
    required this.updatedAt,
    required this.version,
  });

  final String id;
  final String name;
  final String status;
  final int defaultPriority;
  final int handoffSlaSeconds;
  final int claimLeaseSeconds;
  final DateTime updatedAt;
  final int version;

  factory EnterpriseMobileSupportQueue.fromJson(Map<String, Object?> json) {
    final status = supportText(json, 'status', maximum: 32);
    final priority = supportInteger(json, 'defaultPriority', minimum: 0);
    final sla = supportInteger(json, 'handoffSlaSeconds', minimum: 10);
    final lease = supportInteger(json, 'claimLeaseSeconds', minimum: 30);
    if (!const <String>{'active', 'paused', 'disabled'}.contains(status) ||
        priority > 100 ||
        sla > 86400 ||
        lease > 3600) {
      throw const FormatException('Invalid enterprise support queue');
    }
    return EnterpriseMobileSupportQueue(
      id: supportUuid(json, 'id'),
      name: supportText(json, 'name', maximum: 120),
      status: status,
      defaultPriority: priority,
      handoffSlaSeconds: sla,
      claimLeaseSeconds: lease,
      updatedAt: supportTime(json, 'updatedAt'),
      version: supportInteger(json, 'version'),
    );
  }
}

class EnterpriseMobileSupportWorkItem {
  const EnterpriseMobileSupportWorkItem({
    required this.sessionId,
    required this.queueId,
    required this.customerId,
    required this.priority,
    required this.status,
    required this.handoffRequestedAt,
    required this.slaDeadlineAt,
    required this.slaBreached,
    required this.waitSeconds,
    required this.expectedSessionVersion,
    this.intent,
    this.expiredClaimId,
  });

  final String sessionId;
  final String queueId;
  final String customerId;
  final int priority;
  final String status;
  final String? intent;
  final DateTime handoffRequestedAt;
  final DateTime slaDeadlineAt;
  final bool slaBreached;
  final int waitSeconds;
  final int expectedSessionVersion;
  final String? expiredClaimId;

  factory EnterpriseMobileSupportWorkItem.fromJson(
    Map<String, Object?> json,
  ) {
    final status = supportText(json, 'status', maximum: 32);
    final requestedAt = supportTime(json, 'handoffRequestedAt');
    final deadlineAt = supportTime(json, 'slaDeadlineAt');
    final priority = supportInteger(json, 'priority', minimum: 0);
    final breached = json['slaBreached'];
    if (!const <String>{'handoff_requested', 'claim_expired'}
            .contains(status) ||
        priority > 100 ||
        breached is! bool ||
        deadlineAt.isBefore(requestedAt)) {
      throw const FormatException('Invalid enterprise support work item');
    }
    return EnterpriseMobileSupportWorkItem(
      sessionId: supportUuid(json, 'sessionId'),
      queueId: supportUuid(json, 'queueId'),
      customerId: supportUuid(json, 'customerId'),
      priority: priority,
      status: status,
      intent: supportOptionalText(json, 'intent', maximum: 200),
      handoffRequestedAt: requestedAt,
      slaDeadlineAt: deadlineAt,
      slaBreached: breached,
      waitSeconds: supportInteger(json, 'waitSeconds', minimum: 0),
      expectedSessionVersion: supportInteger(json, 'expectedSessionVersion'),
      expiredClaimId: supportOptionalUuid(json, 'expiredClaimId'),
    );
  }
}

class EnterpriseMobileSupportClaim {
  const EnterpriseMobileSupportClaim({
    required this.id,
    required this.supportSessionId,
    required this.queueId,
    required this.agentUserId,
    required this.status,
    required this.claimedAt,
    required this.leaseExpiresAt,
    required this.updatedAt,
    required this.version,
  });

  final String id;
  final String supportSessionId;
  final String queueId;
  final String agentUserId;
  final String status;
  final DateTime claimedAt;
  final DateTime leaseExpiresAt;
  final DateTime updatedAt;
  final int version;

  bool get isActive =>
      status == 'active' && leaseExpiresAt.isAfter(DateTime.now());

  factory EnterpriseMobileSupportClaim.fromJson(
    Map<String, Object?> json, {
    String? expectedSessionId,
  }) {
    final status = supportText(json, 'status', maximum: 32);
    final agentUserId = supportText(json, 'agentUserId', maximum: 128);
    final suppliedSessionId = supportOptionalUuid(json, 'supportSessionId');
    final sessionId = suppliedSessionId ?? expectedSessionId;
    if (!const <String>{'active', 'released', 'reassigned', 'expired'}
            .contains(status) ||
        !supportSubject(agentUserId) ||
        sessionId == null ||
        !supportUuidValue(sessionId) ||
        (expectedSessionId != null && sessionId != expectedSessionId)) {
      throw const FormatException('Invalid enterprise support claim');
    }
    return EnterpriseMobileSupportClaim(
      id: supportUuid(json, 'id'),
      supportSessionId: sessionId,
      queueId: supportUuid(json, 'queueId'),
      agentUserId: agentUserId,
      status: status,
      claimedAt: supportTime(json, 'claimedAt'),
      leaseExpiresAt: supportTime(json, 'leaseExpiresAt'),
      updatedAt: supportTime(json, 'updatedAt'),
      version: supportInteger(json, 'version'),
    );
  }
}

class EnterpriseMobileSupportSession {
  const EnterpriseMobileSupportSession({
    required this.id,
    required this.status,
    required this.updatedAt,
    required this.version,
    this.queueId,
    this.assignedUserId,
    this.activeAgentClaimId,
    this.intent,
    this.priority,
  });

  final String id;
  final String status;
  final String? queueId;
  final String? assignedUserId;
  final String? activeAgentClaimId;
  final String? intent;
  final int? priority;
  final DateTime updatedAt;
  final int version;

  factory EnterpriseMobileSupportSession.fromJson(Map<String, Object?> json) {
    final status = supportText(json, 'status', maximum: 32);
    if (!const <String>{
      'created',
      'waiting',
      'ai_active',
      'handoff_requested',
      'human_active',
      'ended',
      'failed',
    }.contains(status)) {
      throw const FormatException('Invalid enterprise support session');
    }
    final priority = json['priority'];
    if (priority != null &&
        (priority is! int || priority < 0 || priority > 100)) {
      throw const FormatException('Invalid enterprise support priority');
    }
    return EnterpriseMobileSupportSession(
      id: supportUuid(json, 'id'),
      status: status,
      queueId: supportOptionalUuid(json, 'queueId'),
      assignedUserId: supportOptionalText(json, 'assignedUserId', maximum: 128),
      activeAgentClaimId: supportOptionalUuid(json, 'activeAgentClaimId'),
      intent: supportOptionalText(json, 'intent', maximum: 200),
      priority: priority as int?,
      updatedAt: supportTime(json, 'updatedAt'),
      version: supportInteger(json, 'version'),
    );
  }
}

class EnterpriseMobileSupportClaimResult {
  const EnterpriseMobileSupportClaimResult({
    required this.status,
    required this.claim,
    required this.session,
  });

  final String status;
  final EnterpriseMobileSupportClaim claim;
  final EnterpriseMobileSupportSession session;

  factory EnterpriseMobileSupportClaimResult.fromJson(
    Map<String, Object?> json,
  ) {
    final status = supportText(json, 'status', maximum: 16);
    if (!const <String>{'claimed', 'replayed'}.contains(status)) {
      throw const FormatException('Invalid enterprise claim result');
    }
    return EnterpriseMobileSupportClaimResult(
      status: status,
      claim: EnterpriseMobileSupportClaim.fromJson(supportMap(json, 'claim')),
      session:
          EnterpriseMobileSupportSession.fromJson(supportMap(json, 'session')),
    );
  }
}

class EnterpriseMobileSupportReleaseResult {
  const EnterpriseMobileSupportReleaseResult({
    required this.status,
    required this.claim,
    required this.session,
  });

  final String status;
  final EnterpriseMobileSupportClaim claim;
  final EnterpriseMobileSupportSession session;

  factory EnterpriseMobileSupportReleaseResult.fromJson(
    Map<String, Object?> json,
  ) {
    final status = supportText(json, 'status', maximum: 16);
    if (!const <String>{'released', 'replayed'}.contains(status)) {
      throw const FormatException('Invalid enterprise release result');
    }
    return EnterpriseMobileSupportReleaseResult(
      status: status,
      claim: EnterpriseMobileSupportClaim.fromJson(supportMap(json, 'claim')),
      session:
          EnterpriseMobileSupportSession.fromJson(supportMap(json, 'session')),
    );
  }
}

Map<String, Object?> supportMap(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map<String, Object?>) {
    throw FormatException('Invalid enterprise support $key');
  }
  return value;
}

String supportText(
  Map<String, Object?> json,
  String key, {
  int maximum = 160,
}) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty || value.length > maximum) {
    throw FormatException('Invalid enterprise support $key');
  }
  return value.trim();
}

String? supportOptionalText(
  Map<String, Object?> json,
  String key, {
  int maximum = 160,
}) {
  if (json[key] == null) return null;
  return supportText(json, key, maximum: maximum);
}

String supportUuid(Map<String, Object?> json, String key) {
  final value = supportText(json, key, maximum: 36);
  if (!supportUuidValue(value)) {
    throw FormatException('Invalid enterprise support $key');
  }
  return value;
}

String? supportOptionalUuid(Map<String, Object?> json, String key) {
  if (json[key] == null) return null;
  return supportUuid(json, key);
}

int supportInteger(
  Map<String, Object?> json,
  String key, {
  int minimum = 1,
}) {
  final value = json[key];
  if (value is! int || value < minimum) {
    throw FormatException('Invalid enterprise support $key');
  }
  return value;
}

DateTime supportTime(Map<String, Object?> json, String key) {
  final value = supportText(json, key, maximum: 64);
  final parsed = DateTime.tryParse(value);
  if (parsed == null) throw FormatException('Invalid enterprise support $key');
  return parsed.toUtc();
}

bool supportUuidValue(Object? value) =>
    value is String &&
    RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            caseSensitive: false)
        .hasMatch(value);

bool supportSubject(String value) => RegExp(
      r'^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(value);
