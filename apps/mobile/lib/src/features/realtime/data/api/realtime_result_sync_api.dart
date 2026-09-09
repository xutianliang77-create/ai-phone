part of 'realtime_api_client.dart';

extension RealtimeResultSyncApi on RealtimeApiClient {
  String get resultSyncDestination =>
      '${_baseUrl.origin} ($publicDeploymentId)';
  int get accountGeneration => _accountSessionStore is AccountSessionGeneration
      ? (_accountSessionStore as AccountSessionGeneration).generation
      : -1;
  Future<AccountSession> resultSyncAccount(ResultSyncBinding binding) async {
    if (publicDeploymentId.isEmpty ||
        binding.deploymentId != publicDeploymentId ||
        accountGeneration < 0) {
      throw const RealtimeApiException('公有账号身份未就绪');
    }
    final session = await _accountSessionStore.load();
    final scope = AccountRequestScope(
        deploymentId: binding.deploymentId,
        ownerId: binding.ownerId,
        apiBaseUrl: _baseUrl);
    if (session == null ||
        !scope.matches(session) ||
        !(DateTime.tryParse(session.expiresAtIso)?.isAfter(DateTime.now()) ??
            false)) {
      throw const AccountAuthRequiredException();
    }
    return session;
  }

  Future<Map<String, Object?>> resultSyncCall(
      RealtimeSession session, Map<String, Object?> body,
      {required bool consent,
      required bool Function() isCurrent,
      bool readConsent = false}) async {
    final binding = session.syncBinding;
    if (binding == null ||
        publicDeploymentId.isEmpty ||
        binding.deploymentId != publicDeploymentId ||
        accountGeneration < 0 ||
        DateTime.now().isAfter(session.expiresAt)) {
      throw const RealtimeApiException('同步会话已失效');
    }
    final epoch = accountGeneration;
    await verifyAccountDeployment(
        _client, _baseUrl, publicDeploymentId, _requestTimeout);
    if (!isCurrent() || epoch != accountGeneration) {
      throw const RealtimeApiException('同步已取消');
    }
    final account = await resultSyncAccount(binding);
    if (!isCurrent() || epoch != accountGeneration) {
      throw const RealtimeApiException('同步已取消');
    }
    final path = consent ? 'result-sync-consent' : 'segments';
    final request = http.Request(
        readConsent ? 'GET' : 'POST',
        _baseUrl.resolve(
            '/sessions/${Uri.encodeComponent(session.sessionId)}/$path'))
      ..followRedirects = false
      ..headers.addAll({
        'content-type': 'application/json',
        'authorization': 'Bearer ${account.token}'
      })
      ..body = readConsent ? '' : jsonEncode(body);
    final response = await (() async =>
            http.Response.fromStream(await _client.send(request)))()
        .timeout(_requestTimeout);
    final current = await resultSyncAccount(binding);
    if (!isCurrent() ||
        epoch != accountGeneration ||
        account.token != current.token) {
      throw const RealtimeApiException('同步响应已失效');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('同步请求失败：${response.statusCode}',
          statusCode: response.statusCode);
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, Object?>) {
      throw const FormatException('Invalid sync response');
    }
    return decoded;
  }
}
