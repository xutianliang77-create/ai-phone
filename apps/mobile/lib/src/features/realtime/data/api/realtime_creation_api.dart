part of 'realtime_api_client.dart';

extension _BoundRealtimeCreation on RealtimeApiClient {
  Future<RealtimeSession> _createBoundSession() async {
    final op = await ScopedAccountOperation.capture(_accountSessionStore),
        account = op.original;
    final scope = jsonEncode([
      account.issuerOrigin,
      account.deploymentId,
      account.ownerId,
    ]);
    _creationScope = scope;
    final body = await buildCreateRequestBody();
    await op.check();
    var pending = await _creationJournal.load(scope);
    if (pending != null && pending['bodyJson'] != jsonEncode(body)) {
      await _cancelPreparedCreation(pending);
      throw const RealtimeApiException('上次启动已处理，请再次开始以应用新设置');
    }
    if (pending == null) {
      final key = sha256
          .convert(List<int>.generate(32, (_) => Random.secure().nextInt(256)))
          .toString();
      pending = {
        'requestKey': key,
        'bodyJson': jsonEncode(body),
        'sessionId':
            'v10-${sha256.convert(utf8.encode(jsonEncode([account.ownerId, key])))}',
      };
      await _creationJournal.save(scope, pending);
    }
    try {
      final session = await _postCreation(
        Map<String, Object?>.from(
          jsonDecode(pending['bodyJson']! as String) as Map,
        ),
        requestKey: pending['requestKey']! as String,
      );
      await op.check();
      if (session.endpoint.scheme != 'wss' ||
          session.endpoint.host != _baseUrl.host ||
          (session.endpoint.hasPort ? session.endpoint.port : 443) !=
              (_baseUrl.hasPort ? _baseUrl.port : 443) ||
          session.endpoint.userInfo.isNotEmpty ||
          session.endpoint.hasQuery ||
          session.endpoint.hasFragment) {
        throw const RealtimeApiException('会话连接地址与当前服务不一致');
      }
      if (session.sessionId != pending['sessionId']) {
        throw const RealtimeApiException('会话请求身份不匹配');
      }
      if (!session.expiresAt.isAfter(DateTime.now())) {
        await _cancelPreparedCreation(pending);
        throw const RealtimeApiException('上次启动票据已过期，请再次开始');
      }
      return session;
    } on RealtimeApiException catch (error) {
      if (error.code == 'creation_session_terminal') {
        await _creationJournal.clear(scope);
      }
      if (error.code == 'creation_request_conflict') {
        await _cancelPreparedCreation(pending);
      }
      rethrow;
    }
  }

  Future<void> _cancelPreparedCreation(Map<String, Object?> pending) async {
    final sid = pending['sessionId']! as String;
    var response = await _client
        .get(
          _baseUrl.resolve('/realtime/sessions/$sid/status'),
          headers: await _authHeaders(),
        )
        .timeout(_requestTimeout);
    if (response.statusCode == 404) {
      // Recover the exact original request before cancelling it. Never abandon an
      // absent GET while its earlier POST could still commit and reserve minutes.
      await _postCreation(
        Map<String, Object?>.from(
          jsonDecode(pending['bodyJson']! as String) as Map,
        ),
        requestKey: pending['requestKey']! as String,
      );
      response = await _client
          .get(
            _baseUrl.resolve('/realtime/sessions/$sid/status'),
            headers: await _authHeaders(),
          )
          .timeout(_requestTimeout);
    }
    if (response.statusCode != 200) {
      throw const RealtimeApiException('上次启动仍待确认，请稍后重试');
    }
    final status = (jsonDecode(response.body) as Map)['status'];
    if (status == 'ended') {
      await _clearBoundCreation(sid);
      return;
    }
    if (status != 'created') throw const RealtimeApiException('上一会话仍在等待停止确认');
    await endSession(sid);
  }

  Future<void> _clearBoundCreation(String sessionId) async {
    final scope = _creationScope;
    if (!selfHostedAccountEnabled || scope == null) return;
    final pending = await _creationJournal.load(scope);
    if (pending?['sessionId'] == sessionId) await _creationJournal.clear(scope);
  }
}
