part of 'account_api_client.dart';

// The identity check and the account operation share one deadline. Completing
// the abort signal cancels a native POST as well as preventing late dispatch
// after a deployment check eventually returns. Apple authorization codes are
// single use: a timed-out submission must never be retried automatically.
class _AccountRequestDeadline {
  final _watch = Stopwatch()..start();
  final abort = Completer<void>();

  Duration get remaining {
    requireOpen();
    return AccountApiClient.requestTimeout - _watch.elapsed;
  }

  void requireOpen() {
    if (abort.isCompleted ||
        _watch.elapsed >= AccountApiClient.requestTimeout) {
      throw TimeoutException('Account request deadline elapsed');
    }
  }

  void close() {
    _watch.stop();
    if (!abort.isCompleted) abort.complete();
  }
}

Future<void> verifyAccountDeployment(
  http.Client client,
  Uri baseUrl,
  String deploymentId,
  Duration timeout, {
  bool forceRefresh = false,
  void Function(String source)? onEvidence,
}) async {
  try {
    final evidence = await deploymentIdentityCache(client).verify(
      client,
      baseUrl,
      deploymentId,
      timeout,
      forceRefresh: forceRefresh,
    );
    onEvidence?.call(evidence.source);
  } on DeploymentIdentityFailure catch (error) {
    throw AccountApiException(
      'Public deployment identity not ready',
      error.metadata,
    );
  }
}

class AccountApiException implements Exception {
  const AccountApiException(this.message, this.body);

  final String message;
  final Map<String, Object?> body;

  @override
  String toString() => message;
}

class PhoneCodeChallenge {
  const PhoneCodeChallenge({
    required this.challengeId,
    required this.phoneMasked,
    required this.expiresAt,
    this.debugCode,
  });

  final String challengeId;
  final String phoneMasked;
  final DateTime expiresAt;
  final String? debugCode;

  factory PhoneCodeChallenge.fromJson(Map<String, Object?> json) {
    return PhoneCodeChallenge(
      challengeId: json['challengeId'] as String,
      phoneMasked: json['phoneMasked'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      debugCode: json['debugCode'] as String?,
    );
  }
}

class AccountLoginResult {
  const AccountLoginResult({
    required this.token,
    required this.expiresAt,
    required this.account,
  });

  final String token;
  final DateTime expiresAt;
  final AccountProfile account;

  factory AccountLoginResult.fromJson(Map<String, Object?> json) {
    return AccountLoginResult(
      token: json['token'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      account: AccountProfile.fromJson(json['account'] as Map<String, Object?>),
    );
  }
}

class AccountProfile {
  const AccountProfile({
    required this.id,
    required this.phoneMasked,
    required this.status,
    required this.createdAt,
    this.appAccountToken,
  });

  final String id;
  final String phoneMasked;
  final String status;
  final DateTime createdAt;
  final String? appAccountToken;

  factory AccountProfile.fromJson(Map<String, Object?> json) {
    return AccountProfile(
      id: json['id'] as String,
      phoneMasked: json['phoneMasked'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      appAccountToken: json['appAccountToken'] as String?,
    );
  }
}

class AccountExportData {
  const AccountExportData({
    required this.exportedAt,
    required this.sessionCount,
    required this.ledgerCount,
    required this.termCount,
    required this.agentCallCount,
    required this.consentCount,
  });

  final DateTime exportedAt;
  final int sessionCount;
  final int ledgerCount;
  final int termCount;
  final int agentCallCount;
  final int consentCount;

  factory AccountExportData.fromJson(Map<String, Object?> json) {
    return AccountExportData(
      exportedAt: DateTime.parse(json['exportedAt'] as String),
      sessionCount: (json['sessions'] as List<dynamic>).length,
      ledgerCount: (json['billingLedger'] as List<dynamic>).length,
      termCount: (json['termbaseTerms'] as List<dynamic>).length,
      agentCallCount: (json['agentCalls'] as List<dynamic>).length,
      consentCount: (json['consents'] as List<dynamic>? ?? const []).length,
    );
  }
}
