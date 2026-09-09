part of 'realtime_api_client.dart';

extension RealtimePublicCreationApi on RealtimeApiClient {
  void cancelPublicCreationWait() {
    _publicCreationEpoch++;
    final abort = _publicCreationAbort;
    if (abort != null && !abort.isCompleted) abort.complete();
    _publicIssued = null;
  }

  Future<void> confirmPublicCreationConnected(RealtimeSession session) async {
    final issued = _publicIssued;
    if (issued == null) {
      return; // Existing test/legacy implementations have no pending creation.
    }
    if (issued.sessionId != session.sessionId ||
        issued.accountEpoch != accountGeneration) {
      throw const RealtimeApiException('创建确认身份已失效');
    }
    await resultSyncAccount(session.syncBinding!);
    if (issued.accountEpoch != accountGeneration ||
        issued.creationEpoch != _publicCreationEpoch || _publicIssued != issued) {
      throw const RealtimeApiException('创建确认已取消');
    }
    await _publicCreationStore.connected(
        issued.scope, issued.key, session.sessionId);
    _publicIssued = null;
  }

  Future<T> _creationWait<T>(Future<T> work, int epoch) async {
    final abort = _publicCreationAbort!;
    return Future.any<T>([
      work,
      abort.future
          .then<T>((_) => throw const RealtimeApiException('公有创建已取消，请求键已保留'))
    ]).timeout(_requestTimeout, onTimeout: () {
      cancelPublicCreationWait();
      throw TimeoutException('公有创建超时，请求键已保留');
    });
  }

  Future<RealtimeSession> _createPublicSession() async {
    if (_publicCreationClosed) throw const RealtimeApiException('公有客户端已关闭');
    if (_baseUrl.scheme != 'https' ||
        _baseUrl.userInfo.isNotEmpty ||
        _baseUrl.hasQuery ||
        _baseUrl.hasFragment) {
      throw const RealtimeApiException('公有创建需要HTTPS');
    }
    if (_sourceLanguage == 'auto' ||
        _autoReverseTargetLanguage ||
        _sourceLanguage == _targetLanguage) {
      throw const RealtimeApiException('公有自动语种/反向尚未验收，请选择固定语言对');
    }
    if (!const ['natural', 'off'].contains(_voiceOutputMode)) {
      throw const RealtimeApiException('公有创建暂不支持个人声音');
    }
    final epoch = ++_publicCreationEpoch, accountEpoch = accountGeneration;
    _publicCreationAbort = Completer<void>();
    _publicIssued = null;
    void check() {
      if (epoch != _publicCreationEpoch ||
          accountEpoch != accountGeneration ||
          _publicCreationAbort!.isCompleted) {
        throw const RealtimeApiException('公有创建身份或操作已失效');
      }
    }

    final account = await _creationWait(publicLifecycleAccount(), epoch);
    check();
    final scope = AccountRequestScope(
        deploymentId: publicDeploymentId,
        ownerId: account.ownerId!,
        apiBaseUrl: _baseUrl);
    await _creationWait(
        verifyAccountDeployment(
            _client, _baseUrl, publicDeploymentId, _requestTimeout),
        epoch);
    check();
    Future<void> verifyAccount() async {
      check();
      final current = await _creationWait(publicLifecycleAccount(), epoch);
      check();
      if (current.token != account.token || current.ownerId != account.ownerId) {
        throw const AccountAuthRequiredException();
      }
    }

    final voice = _voiceOutputMode == 'natural';
    final settings = publicCreationHash([
      _mode,
      _sourceLanguage,
      _targetLanguage,
      _autoReverseTargetLanguage,
      _voiceOutputMode
    ]);
    var record = await _creationWait(
        _publicCreationStore.pending(scope.storageKey), epoch);
    check();
    if (record != null && record['settings'] != settings) {
      throw const RealtimeApiException('仍有未确认创建，请恢复原设置重试；未自动新建会话');
    }
    if (record == null) {
      await verifyAccount();
      final offer = await _publicCreateHttp(
          'GET',
          '/realtime/sessions/configuration?voiceOutput=$voice',
          account.token,
          epoch);
      check();
      await verifyAccount();
      final body = publicCreationBody(offer,
          deploymentId: publicDeploymentId,
          ownerId: account.ownerId!,
          mode: _mode,
          source: _sourceLanguage,
          target: _targetLanguage,
          voice: voice);
      record = await _creationWait(
          _publicCreationStore.acquire(
              scope.storageKey, settings, body, offer['endpoint']! as String),
          epoch);
      check();
    }
    final pending = record;
    if (pending == null) throw const RealtimeApiException('创建请求未能持久化');
    await verifyAccount();
    final response = await _publicCreateHttp(
        'POST', '/realtime/sessions', account.token, epoch,
        body: pending['body'] as Map<String, Object?>,
        requestKey: pending['key']! as String);
    check();
    await verifyAccount();
    final session = publicCreationResponse(response, pending,
        ownerId: account.ownerId!, deploymentId: publicDeploymentId);
    _publicIssued = (
      scope: scope.storageKey,
      key: pending['key']! as String,
      sessionId: session.sessionId,
      accountEpoch: accountEpoch,
      creationEpoch: epoch
    );
    return session;
  }

  Future<Map<String, Object?>> _publicCreateHttp(
      String method, String path, String token, int epoch,
      {Map<String, Object?>? body, String? requestKey}) async {
    final request = http.AbortableRequest(method, _baseUrl.resolve(path),
        abortTrigger: _publicCreationAbort!.future)
      ..followRedirects = false
      ..headers.addAll({
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
        if (requestKey != null) 'idempotency-key': requestKey
      });
    if (body != null) request.body = jsonEncode(body);
    final response = await _creationWait(_client.send(request), epoch);
    final bytes = <int>[];
    await _creationWait(() async {
      await for (final chunk in response.stream) {
        bytes.addAll(chunk);
        if (bytes.length > 65536) {
          cancelPublicCreationWait();
          throw const FormatException('Public creation response too large');
        }
      }
    }(), epoch);
    if (response.statusCode != 200) {
      throw RealtimeApiException('公有创建未完成：HTTP ${response.statusCode}；未自动重试',
          statusCode: response.statusCode);
    }
    final value = jsonDecode(utf8.decode(bytes));
    if (value is! Map<String, Object?>) {
      throw const FormatException('Invalid public creation JSON');
    }
    return value;
  }
}
