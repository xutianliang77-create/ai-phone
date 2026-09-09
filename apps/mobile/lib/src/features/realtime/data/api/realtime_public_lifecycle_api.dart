part of 'realtime_api_client.dart';

extension RealtimePublicLifecycleApi on RealtimeApiClient {
  Future<AccountSession> publicLifecycleAccount() async {
    if (publicDeploymentId.isEmpty || accountGeneration < 0) {
      throw const RealtimeApiException('公有账号未就绪');
    }
    final account = await _accountSessionStore.load().timeout(_requestTimeout);
    if (account?.ownerId == null) throw const AccountAuthRequiredException();
    return resultSyncAccount(ResultSyncBinding(
            deploymentId: publicDeploymentId,
            ownerId: account!.ownerId!,
            modelPolicyRevision: 'binding-only'))
        .timeout(_requestTimeout);
  }

  Future<Map<String, Object?>> publicLifecycleCall(
      String sessionId, ResultSyncBinding binding,
      {Map<String, Object?>? finalize, bool Function()? isCurrent}) async {
    final epoch = accountGeneration;
    if (publicDeploymentId != binding.deploymentId ||
        epoch < 0 ||
        isCurrent?.call() == false) {
      throw const RealtimeApiException('结束请求身份已失效');
    }
    await verifyAccountDeployment(
        _client, _baseUrl, publicDeploymentId, _requestTimeout);
    final account = await resultSyncAccount(binding).timeout(_requestTimeout);
    if (epoch != accountGeneration || isCurrent?.call() == false) {
      throw const RealtimeApiException('结束请求已取消');
    }
    final path =
        '/realtime/sessions/${Uri.encodeComponent(sessionId)}/${finalize == null ? 'recovery' : 'finalize'}';
    final request =
        http.Request(finalize == null ? 'GET' : 'POST', _baseUrl.resolve(path))
          ..followRedirects = false;
    request.headers.addAll({
      'authorization': 'Bearer ${account.token}',
      'content-type': 'application/json'
    });
    if (finalize != null) request.body = jsonEncode(finalize);
    final response = await (() async =>
            http.Response.fromStream(await _client.send(request)))()
        .timeout(_requestTimeout);
    final current = await resultSyncAccount(binding).timeout(_requestTimeout);
    if (epoch != accountGeneration ||
        account.token != current.token ||
        isCurrent?.call() == false) {
      throw const RealtimeApiException('结束响应已失效');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RealtimeApiException('结束确认未通过：${response.statusCode}',
          statusCode: response.statusCode);
    }
    final data = jsonDecode(response.body);
    if (data is! Map<String, Object?> ||
        data['contractVersion'] != 1 ||
        data['sessionId'] != sessionId ||
        data['deploymentId'] != binding.deploymentId ||
        data['ownerId'] != binding.ownerId ||
        data['modelPolicyRevision'] != binding.modelPolicyRevision) {
      throw const RealtimeApiException('结束响应身份不匹配');
    }
    return data;
  }
}
